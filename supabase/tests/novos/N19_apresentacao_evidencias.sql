-- NOVO — N19: apresentação personalizada, biblioteca de evidências e prévia real (migration 132). Transação sempre desfeita. Somente Dev/teste.
--  · só a fisioterapeuta com vínculo assistencial abre/edita; gestão, comercial, outra fisioterapeuta e paciente NÃO leem o rascunho (nem por SQL)
--  · 16 áreas; salvamento progressivo com concorrência otimista; autoria separada (relatado × avaliado/hipótese); anotação interna nunca publicada
--  · biblioteca nasce VAZIA; fonte original obrigatória; revisão clínica só da gestão; só APROVADAS chegam ao paciente; editar aprovada volta à revisão
--  · publicar cria versão; repetir não duplica; não sobrescreve meta ativa; o paciente só vê a versão liberada; prévia e entrada sem lead prévio com limites
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create or replace function pg_temp.own(sql text) returns text language plpgsql security definer as $$ declare r text; begin execute sql into r; return r; end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; v_pat uuid; st_new uuid; st_sched uuid; svc uuid; prof uuid; prof2 uuid; j jsonb; j2 jsonb; n int; v_rev int; v_pres uuid; e1 uuid; e2 uuid; o1 uuid; o2 uuid;
  ev_a uuid; ev_b uuid; ev_c uuid; ev_d uuid; ev_e uuid; v_err text; v_base_app int; v_pos_a int; v_pos_c int; v_pe_created uuid; v_pe_other uuid; v_pe_active uuid; v_ver int;
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid();
  pe_phy uuid; pe_phy2 uuid; p1 uuid; p2 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select count(*) into v_base_app from public.evidence_references where org_id = v_org and status = 'approved';   -- o Dev pode já ter fichas de testes anteriores: as contagens são relativas
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade N19', 'n19-a') returning id into ua;
  select id into v_pat from public.pipelines where org_id = v_org and kind = 'patients' limit 1;
  select id into st_new from public.pipeline_stages where pipeline_id = v_pat and key = 'new_contact';
  select id into st_sched from public.pipeline_stages where pipeline_id = v_pat and key = 'evaluation_scheduled';
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@n19.local' from unnest(array[u_phy, u_phy2, u_mgr, u_sales, u_p1, u_p2]) x;
  insert into public.people (org_id, unit_id, full_name) select v_org, ua, x from unnest(array['Fisio N19', 'Fisio N19 Dois', 'Paciente N19 Um', 'Paciente N19 Dois']) x;
  select id into pe_phy from public.people where org_id = v_org and full_name = 'Fisio N19' order by created_at desc limit 1;
  select id into pe_phy2 from public.people where org_id = v_org and full_name = 'Fisio N19 Dois' order by created_at desc limit 1;
  select id into p1 from public.people where org_id = v_org and full_name = 'Paciente N19 Um' order by created_at desc limit 1;
  select id into p2 from public.people where org_id = v_org and full_name = 'Paciente N19 Dois' order by created_at desc limit 1;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio'), (u_phy2, v_org, pe_phy2, 'Fisio2'), (u_mgr, v_org, null, 'Gestor'), (u_sales, v_org, null, 'Com'), (u_p1, v_org, p1, 'P1'), (u_p2, v_org, p2, 'P2');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', ua), (v_org, u_phy2, 'physio', ua), (v_org, u_mgr, 'manager', null), (v_org, u_sales, 'sales', ua), (v_org, u_p1, 'member', null), (v_org, u_p2, 'member', null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Avaliação N19', 50) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio N19') returning id into prof;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy2, pe_phy2, 'Fisio N19 Dois') returning id into prof2;
  insert into public.professional_units (professional_id, unit_id) values (prof, ua), (prof2, ua);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time) select v_org, x, ua, w, time '00:00', time '23:30' from unnest(array[prof, prof2]) x, generate_series(0, 6) w;
  -- vínculo pendente do paciente 1 (avaliação agendada com a fisio 1)
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p1, v_pat, st_new, 'Opp N19 p1') returning id into o1;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, opportunity_id) values (v_org, ua, prof, p1, svc, tstzrange(now() + interval '2 days', now() + interval '2 days 50 minutes'), o1);
  update public.opportunities set stage_id = st_sched where id = o1;
  select id into e1 from public.patient_enrollments where person_id = p1;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p2, v_pat, st_new, 'Opp N19 p2') returning id into o2;
  update public.opportunities set stage_id = st_sched where id = o2;         -- p2: pendente sem fisioterapeuta definida
  select id into e2 from public.patient_enrollments where person_id = p2;

  -- ---------------- 1. áreas e privacidade
  rep := rep || pg_temp.chk((select count(*) from public.physio_areas) = 16, 'as 16 áreas da fisioterapia estão cadastradas (categorias de organização)');
  rep := rep || pg_temp.chk((select count(*) from public.evidence_references where org_id = v_org and proposed_by is null) = 0, 'nada na biblioteca foi criado pelo sistema: toda ficha tem um autor humano (nenhuma referência inventada/semeada)');
  set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.evaluation_presentations') like '42501%' and pg_temp.err('select count(*) from public.evidence_references') like '42501%'
    and pg_temp.err('select count(*) from public.presentation_versions') like '42501%' and pg_temp.err('select count(*) from public.presentation_evidence') like '42501%', 'tabelas sem acesso direto (só funções)');
  j := public.presentation_open(e1); v_pres := (j ->> 'id')::uuid; v_rev := (j ->> 'rev')::int;
  rep := rep || pg_temp.chk(v_pres is not null and j ->> 'enrollment_status' = 'pending' and j ->> 'person_name' = 'Paciente N19 Um' and (j ->> 'can_publish')::boolean = false, 'a fisioterapeuta com vínculo abre a apresentação (rascunho vazio, ainda sem poder publicar)');
  rep := rep || pg_temp.chk((public.presentation_open(e1) ->> 'id')::uuid = v_pres, 'abrir de novo reutiliza a mesma apresentação');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.evaluation_presentations where enrollment_id = e1) = 1, 'e não duplica registro');
  rep := rep || pg_temp.chk(exists (select 1 from public.clinical_access_log where person_id = p1 and accessed_by = u_phy and scope = 'apresentacao'), 'o acesso clínico fica registrado');
  set local role authenticated; perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_open(%L)', e1)) like '42501%', 'outra fisioterapeuta (sem vínculo) NÃO abre');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_open(%L)', e1)) like '42501%', 'a gestão NÃO lê o rascunho clínico');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_open(%L)', e1)) like '42501%', 'comercial NÃO lê');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_open(%L)', e1)) like '42501%', 'o paciente NÃO abre a edição profissional');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_open(%L)', e2)) like '42501%', 'nem o vínculo de outro paciente (sem relação assistencial)');

  -- ---------------- 2. captura progressiva, concorrência e autoria
  j := public.presentation_save(v_pres, v_rev, jsonb_build_object('area_keys', jsonb_build_array('traumato_ortopedica', 'esportiva'), 'complaint', 'Dor no ombro ao levantar o braço', 'symptom_duration', 'há 3 meses', 'limitations', 'Não consigo pentear o cabelo', 'activities', 'Voltar a nadar'));
  rep := rep || pg_temp.chk((j ->> 'rev')::int = v_rev + 1, 'salvar progressivamente avança a revisão e devolve o horário do salvamento'); v_rev := (j ->> 'rev')::int;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_save(%L, %s, ''{"complaint":"outra aba"}''::jsonb)', v_pres, v_rev - 1)) like 'P0010%', 'edição simultânea em outra tela é recusada (concorrência otimista), nada é sobrescrito em silêncio');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_save(%L, %s, ''{"area_keys":["inexistente"]}''::jsonb)', v_pres, v_rev)) like '%área inválida%', 'área fora da lista é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_save(%L, %s, ''{"status":"published"}''::jsonb)', v_pres, v_rev)) like '%campo não permitido%', 'campos de controle (status, versão) não são gravados pela tela');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_save(%L, %s, ''{"condition_text":"Tendinopatia do manguito"}''::jsonb)', v_pres, v_rev)) like '%avaliada ou é uma hipótese%', 'condição avaliada × hipótese: precisa dizer qual (são coisas diferentes)');
  j := public.presentation_save(v_pres, v_rev, jsonb_build_object('condition_kind', 'hypothesis', 'condition_text', 'Possível tendinopatia do manguito', 'goal_title', 'Voltar a nadar sem dor', 'goal_target_date', (current_date + 90)::text,
        'freq_per_week', 2, 'duration_weeks', 8, 'routine_text', 'Exercícios 3 vezes por semana em casa', 'reassessment_on', (current_date + 28)::text, 'reassessment_criteria', 'Dor e amplitude', 'internal_notes', 'ANOTAÇÃO INTERNA: suspeita de lesão associada'));
  v_rev := (j ->> 'rev')::int;
  j := public.presentation_open(e1);
  rep := rep || pg_temp.chk(j ->> 'internal_notes' like 'ANOTAÇÃO INTERNA%' and (j -> 'patient_payload' -> 'assessed' ->> 'condition_kind') = 'hypothesis', 'a profissional vê a anotação interna; a hipótese fica marcada como hipótese');
  rep := rep || pg_temp.chk(not ((j -> 'patient_payload')::text like '%ANOTAÇÃO INTERNA%'), 'a anotação interna NÃO entra no conteúdo destinado ao paciente');
  rep := rep || pg_temp.chk((j ->> 'can_publish')::boolean, 'com área, queixa e objetivo já pode publicar');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_save(%L, %s, jsonb_build_object(''complaint'', repeat(''x'', 2001)))', v_pres, v_rev)) is not null, 'texto acima do limite é recusado');

  -- ---------------- 3. biblioteca: proposta, revisão clínica, aprovação
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.evidence_save(null, ''{"title":"Estudo sem fonte"}''::jsonb)')) like '%DOI ou o link%', 'não existe artigo sem fonte original (DOI ou link)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.evidence_save(null, ''{"title":"Estudo com DOI ruim","doi":"abc123"}''::jsonb)')) is not null, 'DOI inválido é recusado');
  ev_a := public.evidence_save(null, jsonb_build_object('title', '[TESTE] Exercícios para dor no ombro: ensaio fictício A', 'authors', 'Autor Fictício', 'journal', 'Revista Teste', 'year', 2020, 'doi', '10.9999/teste.a',
        'study_design', 'Ensaio clínico randomizado (fictício)', 'population', 'Adultos com dor no ombro', 'comparison', 'Exercício × cuidado usual', 'benefits', 'Menos dor (dado fictício de teste)', 'duration', '8 semanas', 'follow_up', '6 meses',
        'limitations', 'Amostra pequena', 'area_keys', jsonb_build_array('traumato_ortopedica'), 'conditions', jsonb_build_array('tendinopatia')));
  ev_b := public.evidence_save(null, jsonb_build_object('title', '[TESTE] Hidroterapia na gerontologia: estudo fictício B', 'url', 'https://example.org/teste-b', 'area_keys', jsonb_build_array('aquatica', 'gerontologia')));
  ev_c := public.evidence_save(null, jsonb_build_object('title', '[TESTE] Treino esportivo de ombro: estudo fictício C', 'doi', 'https://doi.org/10.9999/teste.c', 'area_keys', jsonb_build_array('esportiva')));
  ev_d := public.evidence_save(null, jsonb_build_object('title', '[TESTE] Estudo fictício D da mesma área', 'doi', '10.9999/teste.d', 'area_keys', jsonb_build_array('traumato_ortopedica')));
  ev_e := public.evidence_save(null, jsonb_build_object('title', '[TESTE] Estudo fictício E da mesma área', 'doi', '10.9999/teste.e', 'area_keys', jsonb_build_array('traumato_ortopedica')));
  rep := rep || pg_temp.chk(pg_temp.own(format('select doi from public.evidence_references where id = %L', ev_c)) = '10.9999/teste.c' and pg_temp.own(format('select status from public.evidence_references where id = %L', ev_a)) = 'draft', 'DOI em forma de link é normalizado; toda proposta nasce em rascunho');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.evidence_save(null, ''{"title":"[TESTE] duplicada","doi":"10.9999/TESTE.A"}''::jsonb)')) like '23505%', 'o mesmo DOI não entra duas vezes (comparação sem diferenciar maiúsculas)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.evidence_review(%L, ''approve'', true, null)', ev_a)) like '42501%', 'a fisioterapeuta NÃO aprova a própria proposta (revisão clínica é da gestão)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_evidence_pick(%L, %L, ''serve ao caso'', null)', v_pres, ev_a)) like '%APROVADAS%', 'ficha em rascunho não pode ser usada com o paciente');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(jsonb_array_length(public.evidence_list(null)) = v_base_app and not exists (select 1 from jsonb_array_elements(public.evidence_list(null)) x where x ->> 'status' <> 'approved'), 'outra fisioterapeuta vê só fichas APROVADAS (nunca rascunhos alheios)');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select public.evidence_list(null)') like '42501%', 'paciente não lista a biblioteca');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.evidence_review(%L, ''approve'', false, null)', ev_a)) like '%fonte original%', 'aprovar exige confirmar que a fonte original foi conferida');
  perform public.evidence_review(ev_a, 'approve', true, 'Fonte conferida'); perform public.evidence_review(ev_b, 'approve', true, null); perform public.evidence_review(ev_c, 'approve', true, null);
  perform public.evidence_review(ev_d, 'approve', true, null); perform public.evidence_review(ev_e, 'approve', true, null);
  rep := rep || pg_temp.chk(pg_temp.own(format('select reviewed_by from public.evidence_references where id = %L', ev_a)) = u_mgr::text and pg_temp.own(format('select reviewed_at from public.evidence_references where id = %L', ev_a)) is not null and pg_temp.own(format('select source_verified_at from public.evidence_references where id = %L', ev_a)) is not null, 'aprovação guarda revisor, data e verificação da fonte');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(jsonb_array_length(public.evidence_list('approved')) = v_base_app + 5, 'as 5 fichas recém-aprovadas ficam visíveis para as fisioterapeutas');

  -- ---------------- 4. seleção para o caso: sugestão explicada, confirmação da profissional, limites
  perform pg_temp.as_user(u_phy);
  j := public.evidence_suggest(v_pres);
  select ord into v_pos_a from jsonb_array_elements(j) with ordinality t(x, ord) where (x ->> 'id')::uuid = ev_a; select ord into v_pos_c from jsonb_array_elements(j) with ordinality t(x, ord) where (x ->> 'id')::uuid = ev_c;
  rep := rep || pg_temp.chk(v_pos_a is not null and v_pos_c is not null and v_pos_a < v_pos_c, 'a ficha com área E condição do caso (tendinopatia) vem antes da que só coincide na área');
  rep := rep || pg_temp.chk((select jsonb_array_length(x -> 'why') >= 2 and (x -> 'why')::text like '%Mesma área%' and (x -> 'why')::text like '%Condição citada%' from jsonb_array_elements(j) x where (x ->> 'id')::uuid = ev_a), 'cada sugestão explica POR QUE foi sugerida');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(j) x where (x ->> 'id')::uuid = ev_b), 'ficha de outra área sem relação com o caso não é sugerida');
  perform public.presentation_evidence_pick(v_pres, ev_a, 'Mostra que exercícios orientados ajudam pessoas com dor no ombro como a sua', 'O estudo incluiu adultos de 40 a 60 anos');
  perform public.presentation_evidence_pick(v_pres, ev_c, 'Treino específico para quem quer voltar ao esporte', null);
  perform public.presentation_evidence_pick(v_pres, ev_d, 'Reforça a importância da rotina em casa', null);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_evidence_pick(%L, %L, ''mais um estudo para o caso'', null)', v_pres, ev_e)) like '%um a três%', 'no máximo três estudos por apresentação');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_evidence_pick(%L, %L, ''Texto atualizado para o paciente'', null)', v_pres, ev_a)) is null and jsonb_array_length(public.presentation_open(e1) -> 'evidence_picked') = 3, 'repetir a escolha só atualiza (não duplica: continuam 3)');
  perform public.presentation_evidence_unpick(v_pres, ev_d);
  j := public.presentation_open(e1);
  rep := rep || pg_temp.chk(jsonb_array_length(j -> 'evidence_picked') = 2, 'a profissional confirma/remove: ficam 2 estudos escolhidos');

  -- ---------------- 5. publicação: versão, idempotência, meta, privacidade
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk((public.my_presentation() ->> 'available')::boolean = false, 'antes de publicar o paciente NÃO vê nada (rascunho é privado)');
  perform pg_temp.as_user(u_phy);
  j := public.presentation_publish(v_pres);
  rep := rep || pg_temp.chk((j ->> 'version')::int = 1 and (j ->> 'created')::boolean and (j ->> 'goal_created')::boolean, 'publicar cria a versão 1 e a meta do paciente (que ainda não tinha meta ativa)');
  j2 := public.presentation_publish(v_pres);
  rep := rep || pg_temp.chk((j2 ->> 'version')::int = 1 and not (j2 ->> 'created')::boolean, 'publicar de novo sem mudanças NÃO cria versão nem duplica nada');
  reset role; select count(*) into n from public.patient_goals where person_id = p1 and status = 'active'; rep := rep || pg_temp.chk(n = 1, 'uma única meta ativa');
  set local role authenticated; perform pg_temp.as_user(u_p1);
  j := public.my_presentation();
  rep := rep || pg_temp.chk((j ->> 'available')::boolean and (j ->> 'version')::int = 1 and j ->> 'enrollment_status' = 'pending' and j ->> 'payment' = 'no_contract', 'o paciente (pendente) vê a versão liberada e o estado verdadeiro');
  rep := rep || pg_temp.chk(not (j::text like '%ANOTAÇÃO INTERNA%') and (j -> 'content' -> 'reported' ->> 'complaint') = 'Dor no ombro ao levantar o braço' and jsonb_array_length(j -> 'content' -> 'evidence') = 2, 'vê só o que foi liberado: sem anotação interna e com os 2 estudos aprovados');
  rep := rep || pg_temp.chk((j -> 'content' -> 'assessed' ->> 'condition_kind') = 'hypothesis' and (j -> 'content' -> 'plan' ->> 'freq_per_week')::int = 2, 'hipótese continua marcada como hipótese; plano só com o que foi registrado');
  perform pg_temp.as_user(u_p2);
  rep := rep || pg_temp.chk((public.my_presentation() ->> 'available')::boolean = false, 'outro paciente não vê a apresentação alheia');
  perform pg_temp.as_user(u_phy);
  -- alteração posterior: nova versão com autoria; meta ativa existente não é sobrescrita; evidência retirada da aprovação some da próxima versão
  v_rev := (public.presentation_open(e1) ->> 'rev')::int;
  perform public.presentation_save(v_pres, v_rev, jsonb_build_object('goal_title', 'Outro objetivo depois', 'complaint', 'Dor no ombro direito ao levantar o braço'));
  j := public.presentation_open(e1);
  rep := rep || pg_temp.chk((j ->> 'unpublished_changes')::boolean, 'alterar depois de publicar sinaliza "alterações não publicadas"');
  perform pg_temp.as_user(u_mgr); perform public.evidence_review(ev_c, 'retire', false, 'fora de uso'); perform pg_temp.as_user(u_phy);
  j := public.presentation_publish(v_pres);
  rep := rep || pg_temp.chk((j ->> 'version')::int = 2 and (j ->> 'created')::boolean and not (j ->> 'goal_created')::boolean, 'a mudança gera a versão 2 e NÃO sobrescreve a meta ativa');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_presentation() -> 'content' -> 'evidence') = 1, 'ficha aposentada deixa de aparecer ao paciente');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.presentation_versions where presentation_id = v_pres) = 2 and (select published_by from public.presentation_versions where presentation_id = v_pres and version = 2) = u_phy, 'histórico das versões com autoria');
  set local role authenticated; perform pg_temp.as_user(u_phy);
  perform public.evidence_save(ev_a, jsonb_build_object('title', '[TESTE] Exercícios para dor no ombro: ensaio fictício A (corrigido)', 'doi', '10.9999/teste.a', 'area_keys', jsonb_build_array('traumato_ortopedica')));
  reset role;
  rep := rep || pg_temp.chk((select status from public.evidence_references where id = ev_a) = 'draft' and (select version from public.evidence_references where id = ev_a) = 2 and (select reviewed_at from public.evidence_references where id = ev_a) is null, 'editar uma ficha aprovada a devolve para revisão (nova versão, sem aprovação)');

  -- ---------------- 6. prévia real (leitura) e vínculo encerrado
  set local role authenticated; perform pg_temp.as_user(u_phy);
  j := public.presentation_preview_home(p1);
  rep := rep || pg_temp.chk((j -> 'person' ->> 'name') = 'Paciente N19 Um' and (j -> 'goal' ->> 'title') = 'Voltar a nadar sem dor' and (j -> 'enrollment' ->> 'status') = 'pending' and coalesce(j -> 'package_balance', 'null'::jsonb) = 'null'::jsonb, 'a prévia mostra os dados reais: nome, objetivo, estado pendente e SEM saldo de pacote inventado');
  rep := rep || pg_temp.chk(jsonb_array_length(public.presentation_preview_appointments(p1)) = 1, 'a prévia lista a avaliação agendada (agendamento existente)');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_preview_home(%L)', p1)) like '42501%' and pg_temp.err(format('select public.presentation_preview_appointments(%L)', p1)) like '42501%', 'quem não tem vínculo não vê a prévia');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_preview_home(%L)', p1)) like '42501%', 'a gestão também não (a prévia é do vínculo assistencial)');
  reset role;
  update public.patient_enrollments set status = 'ended', ended_at = now(), end_reason = 'manual' where id = e1; update public.care_relationships set revoked_at = now() where enrollment_id = e1;
  set local role authenticated; perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk((public.my_presentation() ->> 'available')::boolean = false, 'vínculo encerrado: o paciente deixa de ver a apresentação');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.presentation_open(%L)', e1)) like '42501%', 'e a profissional perde o acesso');

  -- ---------------- 7. avaliação sem lead prévio (fluxo existente de cadastro; limites de quem pode iniciar)
  reset role;
  insert into public.people (org_id, unit_id, full_name, created_by) values (v_org, ua, 'Paciente N19 Criado Por Fisio', u_phy) returning id into v_pe_created;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente N19 Qualquer') returning id into v_pe_other;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente N19 Ativo') returning id into v_pe_active;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions, status) select v_org, ua, v_pe_active, id, 10, 'active' from public.products where org_id = v_org limit 1;
  set local role authenticated; perform pg_temp.as_user(u_phy);
  e1 := public.enrollment_start_evaluation(v_pe_created, ua);
  rep := rep || pg_temp.chk(e1 is not null and public.enrollment_start_evaluation(v_pe_created, ua) = e1, 'a fisioterapeuta inicia a avaliação de quem ela mesma cadastrou: cria o vínculo pendente, idempotente');
  rep := rep || pg_temp.chk(pg_temp.own(format('select source from public.patient_enrollments where id = %L', e1)) = 'professional_evaluation' and public.presentation_open(e1) is not null, 'vínculo pendente criado ANTES da apresentação, com acesso da profissional');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_start_evaluation(%L, %L)', v_pe_other, ua)) like '42501%', 'não pode iniciar a avaliação de qualquer pessoa da organização (nem criada por outro, nem sem atendimento)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_start_evaluation(%L, %L)', v_pe_active, ua)) is not null, 'paciente já ativo não vira pendente');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_start_evaluation(%L, %L)', v_pe_created, ua)) like '42501%', 'só profissional com agenda inicia avaliação');
  reset role;
  raise exception 'RELATORIO_N19%', rep;
end $$;
