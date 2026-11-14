-- NOVO — N12: resumo da experiência no formulário de parceria + perfil do parceiro para tags e cards (migration 126). Transação sempre desfeita. Somente Dev/teste.
--  · `resumo_experiencia`: pergunta opcional no fim do formulário de parceria (1 a 1000 caracteres); o formulário de paciente continua recusando
--  · captura progressiva: quem para no meio fica com o que já respondeu (status “em progresso”) e o perfil aparece mesmo incompleto; concluir não exige o resumo
--  · quiz_profiles: perfil do parceiro por pessoa ou por captação (área, experiência, registro, resumo…); nunca devolve paciente; respeita permissões e unidade
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.12.' || n || '.1')::text, true); perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; ub uuid; u_mgr uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; e uuid; pa uuid; pb uuid; pc uuid; pe uuid; t text; r jsonb; n int; txt text := repeat('x', 1000);
  p_end jsonb := '{"objetivos_parceria":{"value":["equipe"],"label":"Atuar na equipe"},"interesses_desenvolvimento":{"value":["gestao"],"label":"Gestão"},"interesse_programa_clinica":{"value":"sim","label":"Sim, teria interesse"},"prazo_programa_clinica":{"value":"tres_meses","label":"Nos próximos 3 meses"}}';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N12)', 'n12-a') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (N12)', 'n12-b') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n12.local'), (u_sb, 'authenticated', 'authenticated', 'sb@n12.local'), (u_phy, 'authenticated', 'authenticated', 'f@n12.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N12'), (u_sb, v_org, null, 'Comercial B N12'), (u_phy, v_org, null, 'Fisio N12');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_sb, 'sales', ub), (v_org, u_phy, 'physio', ua);

  -- a validação do servidor
  rep := rep || pg_temp.chk(private.quiz_validate_answer('parceria', 'resumo_experiencia', '{"value":"8 anos em ortopedia e esportiva","label":"8 anos em ortopedia e esportiva"}'), 'o formulário de parceria aceita o resumo da experiência');
  rep := rep || pg_temp.chk(private.quiz_validate_answer('parceria', 'resumo_experiencia', jsonb_build_object('value', txt, 'label', txt)) and not private.quiz_validate_answer('parceria', 'resumo_experiencia', jsonb_build_object('value', txt || 'x', 'label', 'x')), 'limite de 1000 caracteres');
  rep := rep || pg_temp.chk(not private.quiz_validate_answer('parceria', 'resumo_experiencia', '{"value":"   ","label":"x"}') and not private.quiz_validate_answer('parceria', 'resumo_experiencia', '{"value":["a"],"label":"x"}'), 'em branco e formato errado são recusados');
  rep := rep || pg_temp.chk(not private.quiz_validate_answer('atendimento', 'resumo_experiencia', '{"value":"texto","label":"texto"}'), 'o formulário de paciente continua recusando a pergunta de parceria');
  rep := rep || pg_temp.chk(private.quiz_validate_answer('parceria', 'area_atuacao', '{"value":"neurologica","label":"Neurológica"}') and private.quiz_validate_answer('parceria', 'crefito', '{"value":"CREFITO-3/123456-F","label":"x"}'), 'as demais perguntas de parceria seguem válidas (área, CREFITO)');

  set local role anon;
  perform pg_temp.as_anon(1); a := (public.quiz_start('parceria', 'Ana Completa N12', 'ana.n12@t.local', '11999991201', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(2); b := (public.quiz_start('parceria', 'Bia Parou N12', 'bia.n12@t.local', '11999991202', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(3); c := (public.quiz_start('parceria', 'Caio Sem Resumo N12', 'caio.n12@t.local', '11999991203', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(4); e := (public.quiz_start('atendimento', 'Eva Paciente N12', 'eva.n12@t.local', '11999991204', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null) ->> 'id')::uuid;

  -- Ana: completa, com resumo; Caio: completo, SEM resumo (a pergunta é opcional); Bia: só área e metade do formulário
  perform pg_temp.as_anon(1);
  perform public.quiz_save_progress(a, 6, p_end || '{"momento_profissional":{"value":"em_atuacao","label":"Fisioterapeuta em atuação"},"area_atuacao":{"value":"neurologica","label":"Neurológica"},"situacao_registro":{"value":"ativo","label":"Ativo"},"crefito":{"value":"CREFITO-3/123456-F","label":"CREFITO-3/123456-F"},"modelo_atendimento":{"value":"domiciliar","label":"Atendimento domiciliar"}}'::jsonb, 'São Paulo', 'SP');
  perform public.quiz_save_progress(a, 12, '{"resumo_experiencia":{"value":"8 anos em neurologia adulta, 3 em atendimento domiciliar.","label":"8 anos em neurologia adulta, 3 em atendimento domiciliar."}}'::jsonb);
  perform public.quiz_complete(a);
  perform pg_temp.as_anon(3);
  perform public.quiz_save_progress(c, 6, p_end || '{"momento_profissional":{"value":"estudante","label":"Estudante"},"area_atuacao":{"value":"outra","label":"Outra","detalhe":"Fisioterapia pélvica"},"situacao_registro":{"value":"nao_possuo","label":"Ainda não possuo"}}'::jsonb, 'Campinas', 'SP');
  r := public.quiz_complete(c); rep := rep || pg_temp.chk(r ->> 'status' = 'completed', 'concluir o formulário de parceria não exige o resumo da experiência (opcional)');
  perform pg_temp.as_anon(2);
  perform public.quiz_save_progress(b, 4, '{"momento_profissional":{"value":"formado_iniciando","label":"Formado iniciando atuação"}}'::jsonb, 'Santos', 'SP');
  perform public.quiz_save_progress(b, 5, '{"area_atuacao":{"value":"esportiva","label":"Esportiva"}}'::jsonb);
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 12, ''{"resumo_experiencia":{"value":"","label":""}}''::jsonb)', b));
  rep := rep || pg_temp.chk(t is not null, 'resumo em branco é recusado (quem não quer escrever simplesmente pula a pergunta)');
  perform public.quiz_save_progress(b, 12, '{"resumo_experiencia":{"value":"Recém-formada, estágio em esportiva.","label":"Recém-formada, estágio em esportiva."}}'::jsonb);   -- rascunho gravado antes de terminar
  perform pg_temp.as_anon(4);
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 6, ''{"resumo_experiencia":{"value":"texto","label":"texto"}}''::jsonb)', e));
  rep := rep || pg_temp.chk(t is not null, 'a captação de paciente recusa o resumo da experiência');
  reset role;
  select person_id into pa from public.quiz_leads where id = a; select person_id into pb from public.quiz_leads where id = b; select person_id into pc from public.quiz_leads where id = c; select person_id into pe from public.quiz_leads where id = e;

  -- Bia parou no meio: o que respondeu foi guardado
  rep := rep || pg_temp.chk((select status from public.quiz_leads where id = b) in ('started', 'partial') and (select answers -> 'area_atuacao' ->> 'value' from public.quiz_leads where id = b) = 'esportiva'
      and (select answers -> 'resumo_experiencia' ->> 'value' from public.quiz_leads where id = b) = 'Recém-formada, estágio em esportiva.' and (select city from public.quiz_leads where id = b) = 'Santos', 'quem parou no meio fica com o que já respondeu (área, experiência, resumo, cidade) e sem conclusão');

  -- perfis
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  r := public.quiz_profiles('person', array[pa, pb, pc, pe]); rep := rep || pg_temp.chk(jsonb_array_length(r) = 3, 'perfis por pessoa: 3 parceiros (a paciente nunca entra)');
  rep := rep || pg_temp.chk((select x -> 'area' ->> 'label' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pa) = 'Neurológica' and (select x ->> 'resumo' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pa) like '8 anos em neurologia%'
      and (select x ->> 'crefito' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pa) = 'CREFITO-3/123456-F', 'perfil da Ana: área Neurológica, CREFITO e o resumo escrito');
  rep := rep || pg_temp.chk((select x -> 'area' ->> 'detalhe' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pc) = 'Fisioterapia pélvica' and (select x ->> 'resumo' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pc) is null, 'perfil do Caio: área “Outra” com o texto escrito e sem resumo (não preencheu)');
  rep := rep || pg_temp.chk((select x ->> 'status' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pb) <> 'completed' and (select x -> 'experience' ->> 'label' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pb) = 'Formado iniciando atuação'
      and (select x ->> 'registro' from jsonb_array_elements(r) x where (x ->> 'person_id')::uuid = pb) is null, 'perfil da Bia (parou no meio): mostra o que respondeu, status não concluído, campos não respondidos vazios');
  r := public.quiz_profiles('quiz', array[a, e]); rep := rep || pg_temp.chk(jsonb_array_length(r) = 1 and (r -> 0 ->> 'quiz_id')::uuid = a, 'perfis por captação: só a de parceria volta (a de paciente fica de fora)');
  r := public.quiz_profiles('person', '{}'::uuid[]); rep := rep || pg_temp.chk(r = '[]'::jsonb, 'lista vazia devolve lista vazia');
  rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_profiles(''outro'', array[gen_random_uuid()])') like '%critério inválido%', 'critério desconhecido é recusado');
  -- comercial da unidade B não vê parceiros da unidade A; fisioterapeuta e anônimo não acessam
  perform pg_temp.as_user(u_sb); r := public.quiz_profiles('person', array[pa, pb, pc]); rep := rep || pg_temp.chk(jsonb_array_length(r) = 0, 'comercial só da unidade B não vê os perfis da unidade A');
  perform pg_temp.as_user(u_phy); rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_profiles(''person'', array[gen_random_uuid()])') like '42501%', 'fisioterapeuta não acessa os perfis');
  reset role; set local role anon; perform pg_temp.as_anon(9);
  rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_profiles(''person'', array[gen_random_uuid()])') like '42501%', 'anônimo não acessa os perfis'); reset role;
  raise exception 'RELATORIO_N12%', rep;
end $$;
