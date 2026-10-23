-- RELEASE v1 — S29: CREFITO no quiz de parceria (migration 090). Transação sempre desfeita. Somente Dev/teste.
--  · a resposta `crefito` é validada (texto com número, 3 a 30 caracteres, sem símbolos estranhos) e só existe na jornada de parceria
--  · o CREFITO vai para a ficha (council_registry) da oportunidade de parceiro e da Academy, sem sobrescrever o que já estiver preenchido
--  · o quiz continua concluindo sem o campo (não é obrigatório no servidor)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.29.0.' || n)::text, true); end $$;
create or replace function pg_temp.base(lid uuid) returns void language plpgsql as $$ begin
  perform public.quiz_save_progress(lid, 4, '{}'::jsonb, 'Campinas', 'SP');
  perform public.quiz_save_progress(lid, 5, jsonb_build_object('momento_profissional', jsonb_build_object('value','em_atuacao','label','x'), 'situacao_registro', jsonb_build_object('value','ativo','label','Ativo'),
    'area_atuacao', jsonb_build_object('value','geriatrica','label','x'), 'modelo_atendimento', jsonb_build_object('value','domiciliar','label','x'),
    'objetivos_parceria', jsonb_build_object('value', jsonb_build_array('equipe'), 'label','x'), 'interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('nenhuma'), 'label','x'))); end $$;
do $$
declare
  rep text := ''; res jsonb; l1 uuid; l2 uuid; l3 uuid; l4 uuid; p1 uuid; p2 uuid; v text; n int;
begin
  perform pg_temp.as_anon(1); set local role anon;
  -- 1) parceira com programa da Academy: CREFITO vai para as duas fichas
  res := public.quiz_start('parceria', 'Crefito Um S29', 'crefito.um.s29@example.com', '(19) 98888-2901', 'contact-v1', '/', 'trabalhe-conosco', null, '{}'::jsonb, null); l1 := (res ->> 'id')::uuid;
  perform pg_temp.base(l1);
  perform public.quiz_save_progress(l1, 6, jsonb_build_object('crefito', jsonb_build_object('value', '  CREFITO-3/123456-F ', 'label', 'CREFITO-3/123456-F')));
  perform public.quiz_save_progress(l1, 11, jsonb_build_object('interesse_programa_clinica', jsonb_build_object('value','sim','label','Sim'), 'prazo_programa_clinica', jsonb_build_object('value','tres_meses','label','x')));
  perform public.quiz_complete(l1, false, null);
  reset role;
  select person_id into p1 from public.quiz_leads where id = l1;
  select o.profile ->> 'council_registry' into v from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.person_id = p1 and pl.kind = 'partners';
  rep := rep || pg_temp.chk(v = 'CREFITO-3/123456-F', 'oportunidade de parceiro recebe o CREFITO na ficha (sem espaços nas pontas): ' || coalesce(v, 'vazio'));
  select o.profile ->> 'council_registry' into v from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.person_id = p1 and pl.kind = 'education';
  rep := rep || pg_temp.chk(v = 'CREFITO-3/123456-F', 'oportunidade da Academy (criada na conclusão) também recebe: ' || coalesce(v, 'vazio'));

  -- 2) validação
  set local role anon; perform pg_temp.as_anon(1);
  res := public.quiz_start('parceria', 'Crefito Dois S29', 'crefito.dois.s29@example.com', '(19) 98888-2902', 'contact-v1', '/', 'trabalhe-conosco', null, '{}'::jsonb, null); l2 := (res ->> 'id')::uuid;
  perform pg_temp.base(l2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l2, '{"crefito":{"value":"ab","label":"ab"}}')) like '%resposta inv%', 'CREFITO curto demais é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l2, '{"crefito":{"value":"CREFITO sem numero","label":"x"}}')) like '%resposta inv%', 'CREFITO sem nenhum número é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l2, '{"crefito":{"value":"123456<script>","label":"x"}}')) like '%resposta inv%', 'CREFITO com símbolos estranhos é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l2, '{"crefito":{"value":["123456"],"label":"x"}}')) like '%resposta inv%', 'CREFITO que não é texto é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l2, '{"crefito":{"value":"1234567890123456789012345678901","label":"x"}}')) like '%resposta inv%', 'CREFITO com mais de 30 caracteres é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l2, '{"crefito":{"value":"123456-F","label":"123456-F"}}')) is null, '123456-F é aceito');

  -- 3) paciente não tem CREFITO
  res := public.quiz_start('atendimento', 'Paciente Cinco S29', 'pac.cinco.s29@example.com', '(11) 98888-2905', 'contact-v1', '/', '/avaliacao', null, '{}'::jsonb, null); l4 := (res ->> 'id')::uuid;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.quiz_save_progress(%L, 6, %L::jsonb)', l4, '{"crefito":{"value":"123456-F","label":"x"}}')) like '%resposta inv%', 'o quiz de paciente NÃO aceita CREFITO');

  -- 4) sem CREFITO o quiz conclui (não é obrigatório no servidor) e ficha existente não é sobrescrita
  res := public.quiz_start('parceria', 'Crefito Tres S29', 'crefito.tres.s29@example.com', '(19) 98888-2903', 'contact-v1', '/', 'trabalhe-conosco', null, '{}'::jsonb, null); l3 := (res ->> 'id')::uuid;
  perform pg_temp.base(l3);
  reset role; select person_id into p2 from public.quiz_leads where id = l3;
  update public.opportunities o set profile = jsonb_build_object('council_registry', 'CREFITO-9/999999-F') where o.person_id = p2;
  set local role anon; perform pg_temp.as_anon(1);
  perform public.quiz_save_progress(l3, 6, jsonb_build_object('crefito', jsonb_build_object('value', '111222-F', 'label', '111222-F')));
  perform public.quiz_save_progress(l3, 11, jsonb_build_object('interesse_programa_clinica', jsonb_build_object('value','nao_momento','label','Não')));
  res := public.quiz_complete(l3, false, null);
  reset role;
  rep := rep || pg_temp.chk(res ->> 'status' = 'completed', 'quiz de parceria conclui normalmente');
  select o.profile ->> 'council_registry' into v from public.opportunities o where o.person_id = p2 limit 1;
  rep := rep || pg_temp.chk(v = 'CREFITO-9/999999-F', 'ficha que já tinha registro NÃO é sobrescrita pelo quiz');
  select count(*) into n from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.person_id = p2 and pl.kind = 'education';
  rep := rep || pg_temp.chk(n = 0, 'sem interesse no programa, nenhuma oportunidade da Academy (regra anterior preservada)');

  raise exception E'RELATORIO_S29_QUIZ_CREFITO (transação desfeita):%', rep;
end $$;
