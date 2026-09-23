-- Pesquisas: criar/publicar/encerrar, público-alvo, versionamento imutável, identificada x anônima,
-- k-anonimato no dashboard (só quebra por pergunta/opção com 5+ respostas), permissões de administrar/responder.
-- Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_unit uuid; rep text := '';
  u_mgr uuid; u_member uuid;
  pa uuid[]; up uuid[]; pa_partner uuid; up_partner uuid;
  v_survey uuid; v_q1 uuid; v_q2 uuid; v_resp uuid; v_ver1 uuid; v_ver2 uuid;
  v_anon_survey uuid; v_anon_q uuid; v_anon_resp uuid;
  i int; ok boolean; dash jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org and slug = 'sao-paulo';

  -- gestor (administra pesquisas) e um "membro" comum sem papel de gestão (não deve administrar)
  u_mgr := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'rs.mgr@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_mgr, v_org, 'RS Gestora');
  insert into public.role_assignments (org_id, user_id, role) values (v_org, u_mgr, 'manager');

  -- 5 pacientes (para cruzar o limiar de k-anonimato) + 1 parceiro (público errado, deve ser rejeitado)
  pa := '{}'; up := '{}';
  for i in 1..5 loop
    declare pid uuid; uid uuid; begin
      insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, 'RS Paciente ' || i) returning id into pid;
      insert into public.person_kinds (person_id, kind) values (pid, 'patient');
      uid := gen_random_uuid();
      insert into auth.users (id, aud, role, email) values (uid, 'authenticated', 'authenticated', 'rs.pac' || i || '@t.local');
      insert into public.user_accounts (user_id, org_id, person_id, display_name) values (uid, v_org, pid, 'RS Paciente ' || i);
      insert into public.role_assignments (org_id, user_id, role) values (v_org, uid, 'member');
      pa := pa || pid; up := up || uid;
    end;
  end loop;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, 'RS Parceiro X') returning id into pa_partner;
  insert into public.person_kinds (person_id, kind) values (pa_partner, 'partner');
  up_partner := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (up_partner, 'authenticated', 'authenticated', 'rs.parc@t.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (up_partner, v_org, pa_partner, 'RS Parceiro X');
  insert into public.role_assignments (org_id, user_id, role) values (v_org, up_partner, 'member');

  -- membro sem papel de gestão, mas com pessoa vinculada de outro tipo (não deve administrar pesquisas)
  u_member := up[1];

  -- ---------- criar, adicionar perguntas, publicar (só gestor)
  perform set_config('request.jwt.claims', json_build_object('sub', u_member, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.research_survey_create('Tentativa sem permissão', null, array['patient']::public.person_kind[], false, null); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] membro comum não cria pesquisa', case when not ok then 'OK' else 'FALHA' end);

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.research_survey_create('Satisfação com o atendimento', 'Pesquisa trimestral', array['patient']::public.person_kind[], false, null) into v_survey;
  select public.research_question_upsert(v_survey, null, 'Como você avalia o atendimento?', 'single_choice', array['Ótimo','Bom','Regular','Ruim'], true, 1) into v_q1;
  select public.research_question_upsert(v_survey, null, 'Comentário (opcional)', 'text', null, false, 2) into v_q2;
  begin perform public.research_survey_publish(v_survey); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] gestor cria pesquisa, 2 perguntas e publica', case when ok then 'OK' else 'FALHA' end);

  -- ---------- pessoa fora do público-alvo não consegue responder
  perform set_config('request.jwt.claims', json_build_object('sub', up_partner, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.research_response_submit(v_survey, jsonb_build_array(jsonb_build_object('question_id', v_q1, 'options', jsonb_build_array('Bom')))); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] parceiro (fora do público-alvo "patient") não responde', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- 4 pacientes respondem (abaixo do limiar de k-anonimato)
  for i in 1..4 loop
    perform set_config('request.jwt.claims', json_build_object('sub', up[i], 'role','authenticated')::text, true);
    set local role authenticated;
    perform public.research_response_submit(v_survey, jsonb_build_array(jsonb_build_object('question_id', v_q1, 'options', jsonb_build_array('Bom'))));
    reset role;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.research_dashboard(v_survey, null, null, null) into dash;
  reset role;
  rep := rep || format(E'\n[%s] com 4 respostas, total=4 mas quebra por pergunta ainda indisponível (k-anonimato)', case when (dash->>'total')::int = 4 and (dash->>'breakdown_available')::boolean = false then 'OK' else 'FALHA' end);

  -- ---------- pergunta obrigatória em branco é rejeitada
  perform set_config('request.jwt.claims', json_build_object('sub', up[5], 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.research_response_submit(v_survey, '[]'::jsonb); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] pergunta obrigatória em branco é rejeitada', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- 5º paciente responde: cruza o limiar
  perform set_config('request.jwt.claims', json_build_object('sub', up[5], 'role','authenticated')::text, true);
  set local role authenticated;
  select public.research_response_submit(v_survey, jsonb_build_array(jsonb_build_object('question_id', v_q1, 'options', jsonb_build_array('Ótimo')), jsonb_build_object('question_id', v_q2, 'text', 'Muito bom'))) into v_resp;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.research_dashboard(v_survey, null, null, null) into dash;
  reset role;
  rep := rep || format(E'\n[%s] com 5 respostas, quebra por pergunta liberada e contagem certa (4 Bom + 1 Ótimo)', case when (dash->>'total')::int = 5 and (dash->>'breakdown_available')::boolean = true
    and (dash->'breakdown'->0->'counts'->>'Bom')::int = 4 and (dash->'breakdown'->0->'counts'->>'Ótimo')::int = 1 then 'OK' else 'FALHA' end);

  -- ---------- reenvio da mesma pessoa é rejeitado (pesquisa identificada)
  perform set_config('request.jwt.claims', json_build_object('sub', up[1], 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.research_response_submit(v_survey, jsonb_build_array(jsonb_build_object('question_id', v_q1, 'options', jsonb_build_array('Ruim')))); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] paciente já respondeu — reenvio rejeitado', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- versionamento imutável: editar a pergunta depois de publicada não muda resposta já registrada
  select current_version_id into v_ver1 from public.research_surveys where id = v_survey;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.research_question_upsert(v_survey, v_q1, 'Como você avalia o atendimento recebido? (reformulada)', 'single_choice', array['Ótimo','Bom','Regular','Ruim'], true, 1);
  reset role;
  select current_version_id into v_ver2 from public.research_surveys where id = v_survey;
  rep := rep || format(E'\n[%s] editar pergunta pós-publicação cria nova versão (v1=%s, v2=%s, diferentes)', case when v_ver1 is not null and v_ver2 is not null and v_ver1 <> v_ver2 then 'OK' else 'FALHA' end, v_ver1, v_ver2);
  rep := rep || format(E'\n[%s] resposta antiga continua apontando pra versão antiga (v1), nunca a nova', case when (select version_id from public.research_responses where id = v_resp) = v_ver1 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] snapshot da versão antiga preserva o texto ORIGINAL da pergunta (a atual já foi reformulada)', case when (select snapshot->0->>'prompt' from public.research_survey_versions where id = v_ver1) = 'Como você avalia o atendimento?' then 'OK' else 'FALHA' end);

  -- ---------- pesquisa anônima: person_id nunca é gravado
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.research_survey_create('Pesquisa anônima de bem-estar', null, array['patient']::public.person_kind[], true, null) into v_anon_survey;
  select public.research_question_upsert(v_anon_survey, null, 'Como está seu nível de dor hoje?', 'single_choice', array['Nenhuma','Leve','Moderada','Intensa'], true, 1) into v_anon_q;
  perform public.research_survey_publish(v_anon_survey);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', up[1], 'role','authenticated')::text, true);
  set local role authenticated;
  select public.research_response_submit(v_anon_survey, jsonb_build_array(jsonb_build_object('question_id', v_anon_q, 'options', jsonb_build_array('Leve')))) into v_anon_resp;
  reset role;
  rep := rep || format(E'\n[%s] resposta de pesquisa anônima nunca grava person_id', case when (select person_id from public.research_responses where id = v_anon_resp) is null then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.research_responses_list(v_anon_survey); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] pesquisa anônima não tem lista de respostas individuais (nem pro gestor)', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- encerrar: não aceita mais respostas
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.research_survey_close(v_survey);
  reset role;
  declare up6 uuid; pid6 uuid; begin
    insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, 'RS Paciente 6') returning id into pid6;
    insert into public.person_kinds (person_id, kind) values (pid6, 'patient');
    up6 := gen_random_uuid();
    insert into auth.users (id, aud, role, email) values (up6, 'authenticated', 'authenticated', 'rs.pac6@t.local');
    insert into public.user_accounts (user_id, org_id, person_id, display_name) values (up6, v_org, pid6, 'RS Paciente 6');
    insert into public.role_assignments (org_id, user_id, role) values (v_org, up6, 'member');
    perform set_config('request.jwt.claims', json_build_object('sub', up6, 'role','authenticated')::text, true);
    set local role authenticated;
    begin perform public.research_response_submit(v_survey, jsonb_build_array(jsonb_build_object('question_id', v_q1, 'options', jsonb_build_array('Bom')))); ok := true; exception when others then ok := false; end;
    reset role;
  end;
  rep := rep || format(E'\n[%s] pesquisa encerrada não aceita nova resposta', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- respostas individuais (pesquisa identificada) mostram nome e resposta, à parte do dashboard agregado
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  declare v_list jsonb; begin
    select public.research_responses_list(v_survey) into v_list;
    rep := rep || format(E'\n[%s] lista de respostas individuais da pesquisa identificada tem 5 entradas com nome', case when jsonb_array_length(v_list) = 5 and (v_list->0->>'person_name') is not null then 'OK' else 'FALHA' end);
  end;
  reset role;

  raise exception E'RELATORIO_RESEARCH_SURVEYS (transação desfeita):%', rep;
end $$;
