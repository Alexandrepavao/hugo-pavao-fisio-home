-- CRM: tipos de lead claros, listas com tipo, empresas (B2B) como lead e um lead com várias oportunidades.
--
-- Tipos de lead = tipo do funil (pipelines.kind): patients (paciente), partners (fisioterapeuta que quer fazer parte da equipe),
-- education (fisioterapeuta que quer a HP Academy) e companies (empresa/estabelecimento, B2B). Uma pessoa pode ter UMA oportunidade ABERTA por funil
-- (regra já existente em crm_create_opportunity) e quantas precisar em funis diferentes; cada oportunidade anda sozinha pelas etapas do seu funil.
--
-- 1) crm_lead_lists.kind: tipo da lista (paciente / fisioterapeuta-equipe / fisioterapeuta-Academy / empresa). Listas antigas ficam sem tipo (null) até alguém classificar;
--    toda lista NOVA ou editada exige o tipo (CHECK ... NOT VALID só vale para linhas novas/alteradas).
-- 2) crm_lead_list_companies: empresas em listas do tipo "companies" (pessoas continuam em crm_lead_list_members; nada do que existia muda).
-- 3) opportunities.legal_entity_id: empresa da oportunidade B2B (a pessoa continua sendo o contato; person_id segue obrigatório).
-- 4) crm_create_opportunity ganha p_legal_entity_id (só em funil de empresas; uma oportunidade aberta por empresa e funil).
-- 5) crm_company_create / crm_company_link_contact: o comercial registra uma empresa-lead sem ganhar acesso ao cadastro administrativo completo.
-- 6) crm_pipeline_overview: contagem por funil (abertas, valor, paradas, ganhas, perdidas) no mesmo escopo de acesso de quem consulta.
-- 7) quiz_complete: fisioterapeuta que diz ter interesse (ou quer entender) no programa de clínica própria também ganha uma oportunidade no funil da Academy.

-- ------------------------------------------------------------------ 1) tipo da lista
alter table public.crm_lead_lists add column if not exists kind text;
alter table public.crm_lead_lists drop constraint if exists crm_lead_lists_kind_values;
alter table public.crm_lead_lists add constraint crm_lead_lists_kind_values check (kind is null or kind in ('patients','partners','education','companies'));
alter table public.crm_lead_lists drop constraint if exists crm_lead_lists_kind_required;
alter table public.crm_lead_lists add constraint crm_lead_lists_kind_required check (kind is not null) not valid;

-- ------------------------------------------------------------------ 2) empresas em listas
create table if not exists public.crm_lead_list_companies (
  list_id uuid not null references public.crm_lead_lists(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (list_id, legal_entity_id)
);
alter table public.crm_lead_list_companies enable row level security;
grant select, insert, delete on public.crm_lead_list_companies to authenticated;
create policy crm_list_companies_read on public.crm_lead_list_companies for select to authenticated
  using (exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]))
         and exists (select 1 from public.legal_entities e where e.id = legal_entity_id));
create policy crm_list_companies_write on public.crm_lead_list_companies for insert to authenticated
  with check (exists (select 1 from public.crm_lead_lists l where l.id = list_id and l.kind = 'companies' and private.in_org(l.org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]))
              and exists (select 1 from public.legal_entities e where e.id = legal_entity_id));
create policy crm_list_companies_delete on public.crm_lead_list_companies for delete to authenticated
  using (exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])));

-- ------------------------------------------------------------------ 3) empresa na oportunidade
alter table public.opportunities add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete set null;
create index if not exists opportunities_legal_entity_idx on public.opportunities (legal_entity_id) where legal_entity_id is not null;

-- ------------------------------------------------------------------ 4) crm_create_opportunity com empresa
drop function if exists public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text);
create or replace function public.crm_create_opportunity(
  p_person_id uuid, p_pipeline_id uuid, p_unit_id uuid, p_title text,
  p_product_id uuid default null, p_value_cents bigint default 0, p_owner uuid default null,
  p_source text default null, p_campaign text default null, p_legal_entity_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid := private.current_org(); v_stage uuid; v_id uuid; v_owner uuid; v_kind text;
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  select kind into v_kind from public.pipelines where id = p_pipeline_id and org_id = v_org;
  if v_kind is null then raise exception 'funil não encontrado'; end if;
  if exists (select 1 from public.opportunities where person_id = p_person_id and pipeline_id = p_pipeline_id and status = 'open') then
    raise exception 'já existe uma oportunidade aberta desta pessoa neste funil; abra a existente em vez de criar outra';
  end if;
  if p_legal_entity_id is not null then
    if v_kind <> 'companies' then raise exception 'a empresa só se aplica a oportunidades do funil de empresas'; end if;
    if not exists (select 1 from public.legal_entities where id = p_legal_entity_id and org_id = v_org and merged_into_id is null) then raise exception 'empresa não encontrada'; end if;
    if exists (select 1 from public.opportunities where legal_entity_id = p_legal_entity_id and pipeline_id = p_pipeline_id and status = 'open') then
      raise exception 'já existe uma oportunidade aberta desta empresa neste funil; abra a existente em vez de criar outra';
    end if;
  end if;
  select id into v_stage from public.pipeline_stages where pipeline_id = p_pipeline_id and kind = 'open' order by position limit 1;
  if v_stage is null then raise exception 'funil sem etapas'; end if;
  v_owner := coalesce(p_owner, private.pick_owner(v_org, p_unit_id), (select auth.uid()));
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, product_id, title, value_cents, source, campaign, legal_entity_id, created_by)
  values (v_org, p_unit_id, p_person_id, p_pipeline_id, v_stage, v_owner, p_product_id, p_title, coalesce(p_value_cents, 0), p_source, p_campaign, p_legal_entity_id, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text, uuid) from public, anon;
grant execute on function public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text, uuid) to authenticated;

-- ------------------------------------------------------------------ 5) empresa-lead pelo CRM (sem abrir o cadastro administrativo completo)
create or replace function public.crm_company_create(
  p_legal_name text, p_trade_name text default null, p_cnpj text default null, p_email text default null, p_phone text default null,
  p_city text default null, p_uf text default null, p_unit uuid default null, p_contact_person uuid default null, p_contact_role text default null, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); v_roles public.app_role[] := array['manager','ops_admin','unit_manager','sales']::public.app_role[];
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''); v_id uuid; v_exist uuid;
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
end $$;
revoke all on function public.crm_company_create(text, text, text, text, text, text, text, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.crm_company_create(text, text, text, text, text, text, text, uuid, uuid, text, boolean) to authenticated;

create or replace function public.crm_company_link_contact(p_company uuid, p_person uuid, p_role text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null or not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.legal_entities where id = p_company and org_id = v_org and merged_into_id is null) then raise exception 'empresa não encontrada'; end if;
  if not private.can_read_person(p_person) then raise exception 'sem permissão sobre o contato' using errcode = '42501'; end if;
  insert into public.legal_entity_representatives (legal_entity_id, person_id, role_title, representation_type, is_primary)
    values (p_company, p_person, nullif(btrim(coalesce(p_role, '')), ''), 'contact', not exists (select 1 from public.legal_entity_representatives r where r.legal_entity_id = p_company and r.is_primary))
    on conflict do nothing;
end $$;
revoke all on function public.crm_company_link_contact(uuid, uuid, text) from public, anon;
grant execute on function public.crm_company_link_contact(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------ 6) contagem por funil (security invoker: o escopo é o de quem consulta)
create or replace function public.crm_pipeline_overview() returns table (
  pipeline_id uuid, name text, kind text, open_count int, open_value_cents bigint, stale_count int, people_count int, won_count int, lost_count int
) language sql stable security invoker set search_path = '' as $$
  select p.id, p.name, p.kind,
         (count(o.id) filter (where o.status = 'open'))::int,
         coalesce(sum(o.value_cents) filter (where o.status = 'open'), 0)::bigint,
         (count(o.id) filter (where o.status = 'open' and coalesce(o.last_contact_at, o.created_at) < now() - interval '48 hours'))::int,
         (count(distinct o.person_id) filter (where o.status = 'open'))::int,
         (count(o.id) filter (where o.status = 'won'))::int,
         (count(o.id) filter (where o.status = 'lost'))::int
    from public.pipelines p left join public.opportunities o on o.pipeline_id = p.id
   where p.active and p.org_id = private.current_org()
   group by p.id, p.name, p.kind
   order by case p.kind when 'patients' then 1 when 'partners' then 2 when 'education' then 3 when 'companies' then 4 else 5 end, p.name
$$;
revoke all on function public.crm_pipeline_overview() from public, anon;
grant execute on function public.crm_pipeline_overview() to authenticated;

-- ------------------------------------------------------------------ 7) quiz_complete: interesse no programa de clínica própria também abre oportunidade na Academy
create or replace function public.quiz_complete(p_id uuid, p_marketing_consent boolean default false, p_marketing_consent_version text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads; v_tag uuid; v_protocol text; v_pipe_ed uuid; v_stage_ed uuid; v_opp_ed uuid;
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
  if v.journey = 'parceria' and not (v.answers ? 'objetivos_parceria' and v.answers ? 'interesses_desenvolvimento' and v.answers ? 'interesse_programa_clinica') then
    raise exception 'quiz incompleto';
  end if;
  if v.journey = 'parceria' and (v.answers -> 'interesse_programa_clinica' ->> 'value') <> 'nao_momento' and not (v.answers ? 'prazo_programa_clinica') then
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

    -- interesse (ou vontade de entender) no programa de clínica própria = lead da Academy: segunda oportunidade, no funil da Academy,
    -- sem mexer na oportunidade de parceria. Idempotente: não cria outra se já houver uma aberta da pessoa nesse funil.
    if (v.answers -> 'interesse_programa_clinica' ->> 'value') in ('sim', 'quero_entender') then
      select id into v_pipe_ed from public.pipelines where org_id = v.org_id and kind = 'education' and active order by created_at limit 1;
      if v_pipe_ed is not null and not exists (select 1 from public.opportunities o where o.person_id = v.person_id and o.pipeline_id = v_pipe_ed and o.status = 'open') then
        select id into v_stage_ed from public.pipeline_stages where pipeline_id = v_pipe_ed and kind = 'open' order by position limit 1;
        if v_stage_ed is not null then
          insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, source, campaign, utm)
            values (v.org_id, v.unit_id, v.person_id, v_pipe_ed, v_stage_ed, v.owner_user_id, 'Quiz — interesse em programa de clínica própria (HP Academy)', 'quiz:academy',
                    v.utm ->> 'utm_campaign', coalesce(v.utm, '{}'::jsonb))
            returning id into v_opp_ed;
          insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
            values (v.org_id, v.person_id, v.unit_id, v_opp_ed, 'system',
                    'Interesse no programa de clínica própria registrado no quiz de parceria: ' || (v.answers -> 'interesse_programa_clinica' ->> 'label')
                    || coalesce(' · prazo: ' || (v.answers -> 'prazo_programa_clinica' ->> 'label'), ''));
        end if;
      end if;
    end if;
  end if;

  perform private.emit_event(v.org_id, 'quiz.completed', 'quiz_lead', v.id,
    jsonb_build_object('journey', v.journey, 'opportunity_id', v.opportunity_id, 'person_id', v.person_id), 'quiz_completed:' || v.id);

  return jsonb_build_object('id', v.id, 'status', 'completed', 'protocol', v_protocol, 'first_name', split_part(v.full_name, ' ', 1));
end $$;
grant execute on function public.quiz_complete(uuid,boolean,text) to anon, authenticated;
