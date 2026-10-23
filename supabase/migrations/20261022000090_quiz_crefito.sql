-- Quiz de parceria (parceiro e Academy): novo campo CREFITO, perguntado a quem tem registro "Ativo".
--  · quiz_validate_answer aceita `crefito` (texto de 3 a 30 caracteres, só letras, números, espaço e . / -, com ao menos um número); o resto parte da definição da 081
--  · o CREFITO informado vai para o campo "CREFITO" (council_registry) da ficha da oportunidade de parceiro e da Academy (só se estiver vazio)
-- Não é obrigatório no servidor (o formulário exige; quem estava no meio do quiz na hora da publicação conclui normalmente).

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
      else return false;
    end case;
  end if;
  return false;
end $$;

-- CREFITO do quiz → ficha da oportunidade (parceiro e Academy); só preenche se a ficha ainda não tem registro
create or replace function private.quiz_crefito_to_profile(p_person uuid, p_crefito text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_person is null or nullif(btrim(coalesce(p_crefito, '')), '') is null then return; end if;
  update public.opportunities o set profile = o.profile || jsonb_build_object('council_registry', btrim(p_crefito))
   where o.person_id = p_person and o.status = 'open'
     and exists (select 1 from public.pipelines pl where pl.id = o.pipeline_id and pl.kind in ('partners', 'education'))
     and nullif(btrim(coalesce(o.profile ->> 'council_registry', '')), '') is null;
end $$;
revoke all on function private.quiz_crefito_to_profile(uuid, text) from public, anon, authenticated;

create or replace function private.quiz_crefito_on_answers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.quiz_crefito_to_profile(new.person_id, new.answers -> 'crefito' ->> 'value');
  return null;
end $$;
revoke all on function private.quiz_crefito_on_answers() from public, anon, authenticated;
create trigger quiz_leads_crefito_profile after update of answers on public.quiz_leads
  for each row when (new.answers ? 'crefito') execute function private.quiz_crefito_on_answers();

-- a oportunidade da Academy nasce em quiz_complete, depois das respostas: ao ser criada, recebe o CREFITO do quiz da pessoa
create or replace function private.quiz_crefito_on_new_opportunity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_crefito text;
begin
  select l.answers -> 'crefito' ->> 'value' into v_crefito from public.quiz_leads l
   where l.person_id = new.person_id and l.answers ? 'crefito' order by l.last_activity_at desc limit 1;
  perform private.quiz_crefito_to_profile(new.person_id, v_crefito);
  return null;
end $$;
revoke all on function private.quiz_crefito_on_new_opportunity() from public, anon, authenticated;
create trigger opportunities_quiz_crefito after insert on public.opportunities
  for each row when (new.source in ('quiz:academy', 'quiz:parceria')) execute function private.quiz_crefito_on_new_opportunity();
