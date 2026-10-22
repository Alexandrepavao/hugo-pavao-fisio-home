-- Captação de leads: mapa por estado + lista filtrável por segmento/UF, e cidade/UF OBRIGATÓRIOS para concluir o quiz.
-- Só acrescenta funções novas (nada é removido; list_quiz_leads continua como estava) e endurece quiz_save_progress/quiz_complete.

-- ---------------------------------------------------------------- 1) segmento do lead (mesma regra do CRM: tipo = funil)
-- patient = jornada de atendimento; partner = jornada de parceria; academy = parceria com interesse (ou vontade de entender) no programa de
-- clínica própria — exatamente quem ganha oportunidade no funil da HP Academy em quiz_complete. Um lead pode estar em partner E academy.
create or replace function private.quiz_lead_in_segment(p_journey text, p_answers jsonb, p_segment text) returns boolean
language sql immutable set search_path = '' as $$
  select case coalesce(p_segment, '')
    when '' then true
    when 'patient' then p_journey = 'atendimento'
    when 'partner' then p_journey = 'parceria'
    when 'academy' then p_journey = 'parceria' and (p_answers -> 'interesse_programa_clinica' ->> 'value') in ('sim', 'quero_entender')
    else false end
$$;
revoke all on function private.quiz_lead_in_segment(text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2) lista com filtro de segmento e de estado (UF)
create or replace function public.search_quiz_leads(
  p_segment text default null, p_status text default null, p_needs_review boolean default null,
  p_search text default null, p_uf text default null, p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, journey text, status text, full_name text, email text, phone text, city text, state_uf text,
  origin_path text, page_slug text, started_at timestamptz, completed_at timestamptz, last_activity_at timestamptz,
  owner_user_id uuid, stage_name text, next_contact_at timestamptz, needs_review boolean, wants_academy boolean,
  whatsapp_clicked_at timestamptz, person_id uuid, opportunity_id uuid, has_health_answers boolean, academy_interest boolean, total_count bigint
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select l.* from public.quiz_leads l
     where private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id)
       and private.quiz_lead_in_segment(l.journey, l.answers, p_segment)
       and (p_status is null or l.status = p_status)
       and (p_needs_review is null or l.needs_review = p_needs_review)
       and (p_uf is null or btrim(p_uf) = '' or l.state_uf = upper(btrim(p_uf)))
       and (p_search is null or btrim(p_search) = '' or l.full_name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
  )
  select b.id, b.journey, b.status, b.full_name, b.email, b.phone, b.city, b.state_uf,
         b.origin_path, b.page_slug, b.started_at, b.completed_at, b.last_activity_at,
         b.owner_user_id, ps.name, o.next_contact_at, b.needs_review, b.wants_academy,
         b.whatsapp_clicked_at, b.person_id, b.opportunity_id,
         (b.answers ?| array['dor_intensidade','motivacao_melhora','impacto_qualidade_vida']),
         private.quiz_lead_in_segment(b.journey, b.answers, 'academy'),
         count(*) over ()
  from base b
  left join public.opportunities o on o.id = b.opportunity_id
  left join public.pipeline_stages ps on ps.id = o.stage_id
  order by b.started_at desc
  limit least(coalesce(p_limit, 50), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke all on function public.search_quiz_leads(text, text, boolean, text, text, int, int) from public, anon;
grant execute on function public.search_quiz_leads(text, text, boolean, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------- 3) mapa: quantos leads por estado/cidade (mesmos filtros da lista, menos o estado)
-- Localização = cidade/UF que a própria pessoa preencheu no quiz (nada de IP nem geolocalização do navegador). Quem ainda não chegou à etapa
-- da cidade conta em sem_localizacao. Escopo por unidade igual ao da lista.
create or replace function public.quiz_lead_geo(
  p_segment text default null, p_status text default null, p_needs_review boolean default null, p_search text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with base as (
    select l.state_uf, l.city from public.quiz_leads l
     where private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id)
       and private.quiz_lead_in_segment(l.journey, l.answers, p_segment)
       and (p_status is null or l.status = p_status)
       and (p_needs_review is null or l.needs_review = p_needs_review)
       and (p_search is null or btrim(p_search) = '' or l.full_name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
  ), tot as (
    select count(*) total, count(*) filter (where state_uf is null) sem from base
  ), st as (
    select state_uf, count(*) n from base where state_uf is not null group by state_uf
  ), ct as (
    select initcap(btrim(city)) city, state_uf, count(*) n from base where state_uf is not null and nullif(btrim(city), '') is not null group by 1, 2
  )
  select jsonb_build_object(
    'total', (select total from tot), 'sem_localizacao', (select sem from tot),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('uf', state_uf, 'count', n, 'pct', round(n * 100.0 / nullif((select total - sem from tot), 0), 1)) order by n desc, state_uf), '[]'::jsonb) from st),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('city', city, 'uf', state_uf, 'count', n) order by n desc, city), '[]'::jsonb) from ct))
  into res;
  return res;
end $$;
revoke all on function public.quiz_lead_geo(text, text, boolean, text) from public, anon;
grant execute on function public.quiz_lead_geo(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------- 4) cidade e estado passam a ser obrigatórios (e o estado precisa ser uma UF real)
-- O formulário já pede os dois na etapa 4; agora o servidor também recusa (por quem chamar a API direto) uma UF inventada e a conclusão sem cidade/UF.
create or replace function public.quiz_save_progress(p_id uuid, p_step int, p_answers jsonb, p_city text default null, p_uf text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads; k text; val jsonb; v_merged jsonb; v_uf text := nullif(upper(btrim(coalesce(p_uf, ''))), '');
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
      last_activity_at = now()
    where id = p_id returning * into v;
  return jsonb_build_object('id', v.id, 'status', v.status, 'step_reached', v.step_reached);
end $$;
grant execute on function public.quiz_save_progress(uuid,int,jsonb,text,text) to anon, authenticated;

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
  if v.city is null or btrim(v.city) = '' or v.state_uf is null then
    raise exception 'Informe a cidade e o estado.';
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
