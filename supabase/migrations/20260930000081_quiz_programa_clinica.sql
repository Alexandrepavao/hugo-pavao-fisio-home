-- Quiz de parceria (fisioterapeuta): perguntas finais sobre o interesse, no futuro, em um programa de ensino para ter a própria clínica
-- (posicionamento de marca → sistema de gestão 360). O programa ainda NÃO existe: a resposta só mede interesse (nada é vendido, inscrito ou cobrado).
--  · interesse_programa_clinica: sim | quero_entender | nao_momento (obrigatória para concluir)
--  · prazo_programa_clinica: tres_meses | tres_seis_meses | mais_seis_meses | nao_sei (obrigatória só quando há interesse)
-- `quiz_validate_answer` e `quiz_complete` partem das definições da 038 (a 053 só mexeu em quiz_start); o GRANT é repetido.

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
      when 'interesse_programa_clinica' then return jsonb_typeof(p_value -> 'value') = 'string' and v_val = any (array['sim','quero_entender','nao_momento']);
      when 'prazo_programa_clinica' then return jsonb_typeof(p_value -> 'value') = 'string' and v_val = any (array['tres_meses','tres_seis_meses','mais_seis_meses','nao_sei']);
      else return false;
    end case;
  end if;
  return false;
end $$;

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
  if v.journey = 'parceria' and not (v.answers ? 'objetivos_parceria' and v.answers ? 'interesses_desenvolvimento' and v.answers ? 'interesse_programa_clinica') then
    raise exception 'quiz incompleto';
  end if;
  -- com interesse no programa (sim / quero entender), o prazo também é obrigatório; "não neste momento" dispensa
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
  end if;

  perform private.emit_event(v.org_id, 'quiz.completed', 'quiz_lead', v.id,
    jsonb_build_object('journey', v.journey, 'opportunity_id', v.opportunity_id, 'person_id', v.person_id), 'quiz_completed:' || v.id);

  return jsonb_build_object('id', v.id, 'status', 'completed', 'protocol', v_protocol, 'first_name', split_part(v.full_name, ' ', 1));
end $$;

grant execute on function public.quiz_complete(uuid,boolean,text) to anon, authenticated;
