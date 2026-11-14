-- NOVO — N11: filtros do lead de parceiro (experiência profissional e área) + isolamento entre o formulário de parceria e o de paciente (migration 125). Transação sempre desfeita. Somente Dev/teste.
--  · isolamento: quem preenche o formulário de PARCERIA vira lead de parceiro (e, se pedir o programa de clínica, também da Academy) — nunca paciente; quem preenche o de PACIENTE não vira parceiro.
--    O servidor recusa a resposta de um formulário no outro (chave de pergunta é validada pela jornada).
--  · filtros: experiência (momento profissional) e área de atuação, na lista e no mapa; só valem para parceria (paciente nunca aparece quando um dos dois está ligado); a lista devolve o texto das duas respostas
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.11.' || n || '.1')::text, true); perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; d uuid; e uuid; pa uuid; pb uuid; pc uuid; pd uuid; pe uuid; t text; n int; g jsonb; lbl text; ans_ok jsonb;
  p_partner jsonb := '{"objetivos_parceria":{"value":["equipe"],"label":"Atuar na equipe"},"interesses_desenvolvimento":{"value":["gestao"],"label":"Gestão"},"interesse_programa_clinica":{"value":"nao_momento","label":"Não neste momento"}}';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N11)', 'n11-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n11.local'), (u_phy, 'authenticated', 'authenticated', 'f@n11.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N11'), (u_phy, v_org, null, 'Fisio N11');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_phy, 'physio', ua);

  -- ---------------- cinco captações: 4 de parceria (experiências e áreas diferentes) e 1 de paciente
  set local role anon;
  perform pg_temp.as_anon(1); a := (public.quiz_start('parceria', 'Ana Parceira N11', 'ana.n11@t.local', '11999991101', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(2); b := (public.quiz_start('parceria', 'Bia Estudante N11', 'bia.n11@t.local', '11999991102', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(3); c := (public.quiz_start('parceria', 'Caio Gestor N11', 'caio.n11@t.local', '11999991103', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(4); d := (public.quiz_start('parceria', 'Davi Academy N11', 'davi.n11@t.local', '11999991104', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null) ->> 'id')::uuid;
  perform pg_temp.as_anon(5); e := (public.quiz_start('atendimento', 'Eva Paciente N11', 'eva.n11@t.local', '11999991105', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null) ->> 'id')::uuid;

  perform pg_temp.as_anon(5); perform public.quiz_set_health_consent(e, 'health-v1');   -- o formulário de paciente pede a autorização de dados de saúde antes das perguntas
  -- um formulário não aceita as respostas do outro (a chave da pergunta é validada pela jornada)
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 3, ''{"dor_intensidade":{"value":"7","label":"7"}}''::jsonb, ''São Paulo'', ''SP'')', a));
  rep := rep || pg_temp.chk(t is not null, 'o formulário de parceria recusa a resposta do formulário de paciente (dor_intensidade)');
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 3, ''{"momento_profissional":{"value":"em_atuacao","label":"Em atuação"}}''::jsonb, ''São Paulo'', ''SP'')', e));
  rep := rep || pg_temp.chk(t is not null, 'o formulário de paciente recusa a resposta do formulário de parceria (momento_profissional)');

  -- Ana: em atuação · ortopedia · CREFITO ativo
  perform pg_temp.as_anon(1); perform public.quiz_save_progress(a, 6, p_partner || '{"momento_profissional":{"value":"em_atuacao","label":"Fisioterapeuta em atuação"},"area_atuacao":{"value":"ortopedia","label":"Ortopedia"},"situacao_registro":{"value":"em_regularizacao","label":"Em regularização"}}'::jsonb, 'São Paulo', 'SP'); perform public.quiz_complete(a);
  -- Bia: estudante · neurológica
  perform pg_temp.as_anon(2); perform public.quiz_save_progress(b, 6, p_partner || '{"momento_profissional":{"value":"estudante","label":"Estudante"},"area_atuacao":{"value":"neurologica","label":"Neurológica"},"situacao_registro":{"value":"nao_possuo","label":"Ainda não possuo"}}'::jsonb, 'Campinas', 'SP'); perform public.quiz_complete(b);
  -- Caio: gestor · outra (com detalhe)
  perform pg_temp.as_anon(3); perform public.quiz_save_progress(c, 6, p_partner || '{"momento_profissional":{"value":"gestor_proprietario","label":"Gestor ou proprietário de clínica"},"area_atuacao":{"value":"outra","label":"Outra","detalhe":"Fisioterapia pélvica"},"situacao_registro":{"value":"em_regularizacao","label":"Em regularização"}}'::jsonb, 'Santos', 'SP'); perform public.quiz_complete(c);
  -- Davi: em atuação · ortopedia · quer o programa de clínica (vira Academy também)
  perform pg_temp.as_anon(4); perform public.quiz_save_progress(d, 6, '{"objetivos_parceria":{"value":["equipe"],"label":"Atuar na equipe"},"interesses_desenvolvimento":{"value":["gestao"],"label":"Gestão"},"interesse_programa_clinica":{"value":"sim","label":"Sim, teria interesse"},"prazo_programa_clinica":{"value":"tres_meses","label":"Nos próximos 3 meses"},"momento_profissional":{"value":"em_atuacao","label":"Fisioterapeuta em atuação"},"area_atuacao":{"value":"ortopedia","label":"Ortopedia"},"situacao_registro":{"value":"nao_possuo","label":"Ainda não possuo"}}'::jsonb, 'São Paulo', 'SP'); perform public.quiz_complete(d);
  -- Eva: paciente
  perform pg_temp.as_anon(5); perform public.quiz_save_progress(e, 6, '{"dor_intensidade":{"value":"6","label":"6"},"motivacao_melhora":{"value":"8","label":"8"},"impacto_qualidade_vida":{"value":"7","label":"7"},"atividade_desejada":{"value":"trabalhar","label":"Trabalhar"},"interesse_acompanhamento":{"value":"sim","label":"Sim"},"faixa_investimento":{"value":"ate_250","label":"Até R$ 250"}}'::jsonb, 'São Paulo', 'SP'); perform public.quiz_complete(e);
  reset role;
  select person_id into pa from public.quiz_leads where id = a; select person_id into pb from public.quiz_leads where id = b; select person_id into pc from public.quiz_leads where id = c; select person_id into pd from public.quiz_leads where id = d; select person_id into pe from public.quiz_leads where id = e;

  -- ---------------- isolamento: parceria nunca vira paciente (e o contrário)
  select count(*) into n from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id in (pa, pb, pc, pd) and p.kind = 'patients';
  rep := rep || pg_temp.chk(n = 0, 'quem preencheu o formulário de parceria não ganha oportunidade no funil de PACIENTE');
  select count(*) into n from public.person_kinds where person_id in (pa, pb, pc, pd) and kind::text = 'patient';
  rep := rep || pg_temp.chk(n = 0, 'nem entra como “paciente” no cadastro de pessoas');
  select count(*) into n from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id in (pa, pb, pc, pd) and p.kind = 'partners' and o.source = 'quiz:parceria';
  rep := rep || pg_temp.chk(n = 4, 'as 4 captações de parceria geram oportunidade só no funil de PARCEIRO');
  select count(*) into n from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id = pd and p.kind = 'education';
  rep := rep || pg_temp.chk(n = 1 and (select count(*) from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id in (pa, pb, pc) and p.kind = 'education') = 0, 'só quem pediu o programa de clínica (Davi) também entra na HP Academy — continua fora do funil de paciente');
  select count(*) into n from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id = pe and p.kind <> 'patients';
  rep := rep || pg_temp.chk(n = 0 and (select count(*) from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id = pe and p.kind = 'patients') = 1, 'quem preencheu o formulário de paciente fica só no funil de PACIENTE (nada de parceiro nem Academy)');
  rep := rep || pg_temp.chk((select count(*) from public.quiz_leads where person_id in (pa, pb, pc, pd) and journey <> 'parceria') = 0 and (select count(*) from public.quiz_leads where person_id = pe and journey <> 'atendimento') = 0, 'cada captação guarda a jornada do formulário que a pessoa preencheu');

  -- ---------------- filtros (gestor)
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11'); rep := rep || pg_temp.chk(n = 4, 'segmento Parceiros sem filtro: as 4 captações de parceria (a de paciente não entra)');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'em_atuacao'); rep := rep || pg_temp.chk(n = 2, 'experiência “em atuação”: Ana e Davi');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'estudante'); rep := rep || pg_temp.chk(n = 1 and (select full_name from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'estudante')) = 'Bia Estudante N11', 'experiência “estudante”: só a Bia');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_area => 'ortopedia'); rep := rep || pg_temp.chk(n = 2, 'área “ortopedia”: Ana e Davi');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'em_atuacao', p_area => 'neurologica'); rep := rep || pg_temp.chk(n = 0, 'experiência + área combinadas (em atuação + neurológica): ninguém');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'em_atuacao', p_area => 'ortopedia'); rep := rep || pg_temp.chk(n = 2, 'experiência + área combinadas (em atuação + ortopedia): Ana e Davi');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'academy', p_search => 'n11', p_area => 'ortopedia'); rep := rep || pg_temp.chk(n = 1 and (select full_name from public.search_quiz_leads_v2(p_segment => 'academy', p_search => 'n11', p_area => 'ortopedia')) = 'Davi Academy N11', 'segmento HP Academy + área ortopedia: só o Davi');
  select count(*) into n from public.search_quiz_leads_v2(p_search => 'n11', p_experience => 'em_atuacao'); rep := rep || pg_temp.chk(n = 2, 'sem segmento, o filtro de experiência já exclui o paciente (paciente nunca tem essa resposta)');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'patient', p_search => 'n11', p_area => 'ortopedia'); rep := rep || pg_temp.chk(n = 0, 'segmento Pacientes + área: nenhum (o filtro só vale para parceiros)');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'patient', p_search => 'n11'); rep := rep || pg_temp.chk(n = 1, 'segmento Pacientes sem filtro: só a Eva');
  select count(*) into n from public.search_quiz_leads_v2(p_search => 'n11', p_experience => ''); rep := rep || pg_temp.chk(n = 5, 'filtro em branco = sem filtro (5 captações)');
  select experience_label || ' · ' || area_label into lbl from public.search_quiz_leads_v2(p_search => 'ana.n11');
  rep := rep || pg_temp.chk(lbl = 'Fisioterapeuta em atuação · Ortopedia', 'a lista devolve o texto das duas respostas (Fisioterapeuta em atuação · Ortopedia)');
  select area_label into lbl from public.search_quiz_leads_v2(p_search => 'caio.n11'); rep := rep || pg_temp.chk(lbl = 'Outra — Fisioterapia pélvica', 'área “Outra” mostra o que a pessoa escreveu');
  select count(*) into n from public.search_quiz_leads_v2(p_search => 'eva.n11') where experience_label is null and area_label is null; rep := rep || pg_temp.chk(n = 1, 'captação de paciente não traz experiência nem área');
  select count(*) into n from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'em_atuacao'' or ''1''=''1'); rep := rep || pg_temp.chk(n = 0, 'valor estranho no filtro não vira consulta (nenhum resultado)');
  -- mapa: mesmos filtros
  g := public.quiz_lead_geo_v2(p_segment => 'partner', p_search => 'n11'); rep := rep || pg_temp.chk((g ->> 'total')::int = 4, 'mapa: 4 parceiros');
  g := public.quiz_lead_geo_v2(p_segment => 'partner', p_search => 'n11', p_experience => 'em_atuacao'); rep := rep || pg_temp.chk((g ->> 'total')::int = 2 and (g -> 'by_state' -> 0 ->> 'uf') = 'SP', 'mapa com experiência “em atuação”: 2 captações, estado SP');
  g := public.quiz_lead_geo_v2(p_segment => 'partner', p_search => 'n11', p_area => 'neurologica'); rep := rep || pg_temp.chk((g ->> 'total')::int = 1 and (g -> 'by_city' -> 0 ->> 'city') = 'Campinas', 'mapa com área “neurológica”: 1 captação, em Campinas');
  g := public.quiz_lead_geo_v2(p_search => 'n11', p_area => 'ortopedia'); rep := rep || pg_temp.chk((g ->> 'total')::int = 2, 'mapa sem segmento: a área também exclui o paciente');
  -- permissões
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.search_quiz_leads_v2(p_segment => ''partner'')') is null and (select count(*) from public.search_quiz_leads_v2(p_segment => 'partner', p_search => 'n11') ) = 0, 'fisioterapeuta não vê nenhuma captação');
  rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_lead_geo_v2(''partner'')') like '42501%', 'fisioterapeuta não abre o mapa das captações');
  reset role; set local role anon; perform pg_temp.as_anon(9);
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.search_quiz_leads_v2()') like '42501%' and pg_temp.err('select public.quiz_lead_geo_v2()') like '42501%', 'anônimo não acessa a lista nem o mapa'); reset role;
  raise exception 'RELATORIO_N11%', rep;
end $$;
