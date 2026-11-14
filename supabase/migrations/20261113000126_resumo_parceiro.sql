-- HP Group Hub — 126 Formulário de parceria: resumo da experiência profissional + perfil do parceiro nos cards do CRM e da Captação.
--  · nova pergunta OPCIONAL no fim do formulário de parceria: `resumo_experiencia` (texto livre, 1 a 1000 caracteres). O servidor passa a aceitá-la (quiz_validate_answer, a definição da 090 + esta chave);
--    quiz_complete não a exige — quem pula ou para no meio continua sendo captado com o que respondeu até ali.
--  · quiz_profiles(p_by, p_ids): devolve, para uma lista de pessoas ('person') ou de captações ('quiz'), o PERFIL do parceiro vindo do formulário de parceria (experiência, área de atuação ou interesse,
--    registro, modelo de atendimento, objetivos, interesse no programa de clínica e o resumo da experiência). Serve às tags e aos resumos dos cards. Só leitura; nunca devolve respostas de saúde
--    (o formulário de paciente não entra); mesmas permissões e escopo de unidade da Captação de leads (gestor, administrativo, gestor de unidade e comercial).
-- Nada existente é removido nem alterado de forma incompatível.

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
      when 'crefito' then
        return jsonb_typeof(p_value -> 'value') = 'string' and length(btrim(v_val)) between 3 and 30 and btrim(v_val) ~ '^[A-Za-z0-9./ -]+$' and btrim(v_val) ~ '[0-9]';
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
      when 'resumo_experiencia' then return jsonb_typeof(p_value -> 'value') = 'string' and length(btrim(v_val)) between 1 and 1000;
      else return false;
    end case;
  end if;
  return false;
end $$;

create or replace function public.quiz_profiles(p_by text, p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_by is null or p_by not in ('person', 'quiz') then raise exception 'critério inválido'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then return '[]'::jsonb; end if;
  if cardinality(p_ids) > 300 then raise exception 'itens demais numa consulta'; end if;
  with src as (
    select distinct on (case when p_by = 'person' then l.person_id else l.id end) l.*
      from public.quiz_leads l
     where l.journey = 'parceria' and private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id)
       and (case when p_by = 'person' then l.person_id = any (p_ids) else l.id = any (p_ids) end)
     order by (case when p_by = 'person' then l.person_id else l.id end), l.started_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', s.person_id, 'quiz_id', s.id, 'status', s.status, 'city', s.city, 'state_uf', s.state_uf,
           'experience', s.answers -> 'momento_profissional', 'area', s.answers -> 'area_atuacao', 'registro', s.answers -> 'situacao_registro', 'crefito', s.answers -> 'crefito' ->> 'value',
           'modelo', s.answers -> 'modelo_atendimento', 'objetivos', s.answers -> 'objetivos_parceria' ->> 'label', 'programa', s.answers -> 'interesse_programa_clinica' ->> 'label',
           'resumo', s.answers -> 'resumo_experiencia' ->> 'value')), '[]'::jsonb)
    into res from src s;
  return res;
end $$;
revoke all on function public.quiz_profiles(text, uuid[]) from public, anon;
grant execute on function public.quiz_profiles(text, uuid[]) to authenticated;
