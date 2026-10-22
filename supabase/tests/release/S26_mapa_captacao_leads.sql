-- RELEASE v1 — S26: mapa de captação de leads por estado, lista por segmento/UF e cidade/UF obrigatórios no quiz (migration 087). Transação sempre desfeita. Somente Dev/teste.
--  · segmentos: paciente (atendimento), parceiro (parceria) e Academy (parceria com interesse no programa de clínica própria); a UF filtra a lista
--  · mapa (quiz_lead_geo): conta por estado/cidade o que a pessoa preencheu; quem ainda não informou o local entra em "sem localização"; contagem bate com a lista
--  · cidade e estado: UF inventada é recusada; o quiz não conclui sem cidade e estado; o detalhe do lead mostra os dois
--  · permissões: fisioterapeuta e anônimo não leem; comercial lê (mesma regra da lista atual)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.uf_n(g jsonb, uf text) returns int language sql as $$ select coalesce((select (x ->> 'count')::int from jsonb_array_elements(g -> 'by_state') x where x ->> 'uf' = uf), 0) $$;
create or replace function pg_temp.fim_atend(lid uuid) returns void language plpgsql as $$ begin
  perform public.quiz_save_progress(lid, 5, jsonb_build_object('interesse_acompanhamento', jsonb_build_object('value','sim','label','Sim'), 'faixa_investimento', jsonb_build_object('value','ate_250','label','Até R$ 250')));
  perform public.quiz_complete(lid, false, null); end $$;
create or replace function pg_temp.fim_parc(lid uuid, prog text) returns void language plpgsql as $$ begin
  perform public.quiz_save_progress(lid, 5, jsonb_build_object('momento_profissional', jsonb_build_object('value','em_atuacao','label','x'), 'situacao_registro', jsonb_build_object('value','ativo','label','x'),
    'area_atuacao', jsonb_build_object('value','ortopedia','label','x'), 'modelo_atendimento', jsonb_build_object('value','domiciliar','label','x'),
    'objetivos_parceria', jsonb_build_object('value', jsonb_build_array('desenvolver_negocio'), 'label','x'), 'interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('gestao'), 'label','x')));
  perform public.quiz_save_progress(lid, 11, jsonb_build_object('interesse_programa_clinica', jsonb_build_object('value', prog, 'label', 'x')) ||
    case when prog = 'nao_momento' then '{}'::jsonb else jsonb_build_object('prazo_programa_clinica', jsonb_build_object('value','tres_meses','label','Nos próximos 3 meses')) end);
  perform public.quiz_complete(lid, false, null); end $$;
do $$
declare
  v_org uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); v_unit uuid;
  rep text := ''; res jsonb; g0 jsonb; g1 jsonb; g2 jsonb; l_pat uuid; l_par uuid; l_aca uuid; l_nocity uuid; l_pat2 uuid; n bigint; n0 bigint; d jsonb; t text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org order by created_at limit 1;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s26.local'),(u_sales,'authenticated','authenticated','s@s26.local'),(u_phy,'authenticated','authenticated','p@s26.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S26'),(u_sales, v_org, null, 'Comercial S26'),(u_phy, v_org, null, 'Fisio S26');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_unit),(v_org, u_phy, 'physio', v_unit);

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  g0 := public.quiz_lead_geo(null, null, null, null);
  reset role;

  -- ============ 1) quatro envios: paciente (SP), parceiro sem interesse no programa (RJ), parceiro com interesse no programa = Academy (SP), paciente que parou antes da cidade
  set local role anon;
  res := public.quiz_start('atendimento', 'Paciente Mapa S26', 'pac.mapa.s26@example.com', '(11) 98888-2601', 'contact-v1', '/', '/avaliacao', null, '{}'::jsonb, null); l_pat := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(l_pat, 4, '{}'::jsonb, 'Santo André', 'sp'); perform pg_temp.fim_atend(l_pat);
  res := public.quiz_start('parceria', 'Parceiro Mapa S26', 'par.mapa.s26@example.com', '(21) 98888-2602', 'contact-v1', '/trabalhe-conosco', 'trabalhe-conosco', null, '{}'::jsonb, null); l_par := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(l_par, 4, '{}'::jsonb, 'Niterói', 'RJ'); perform pg_temp.fim_parc(l_par, 'nao_momento');
  res := public.quiz_start('parceria', 'Academy Mapa S26', 'aca.mapa.s26@example.com', '(11) 98888-2603', 'contact-v1', '/trabalhe-conosco', 'trabalhe-conosco', null, '{}'::jsonb, null); l_aca := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(l_aca, 4, '{}'::jsonb, 'Campinas', 'SP'); perform pg_temp.fim_parc(l_aca, 'quero_entender');
  res := public.quiz_start('atendimento', 'Sem Cidade Mapa S26', 'sem.mapa.s26@example.com', '(11) 98888-2604', 'contact-v1', '/', '/avaliacao', null, '{}'::jsonb, null); l_nocity := (res ->> 'id')::uuid;
  reset role;
  rep := rep || pg_temp.chk((select state_uf from public.quiz_leads where id = l_pat) = 'SP', 'estado digitado em minúsculas é gravado em maiúsculas (SP)');

  -- ============ 2) cidade e estado obrigatórios
  set local role anon;
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''Cidade X'', ''XX'')', l_nocity));
  rep := rep || pg_temp.chk(t like '%estado inv%', 'UF inventada (XX) é recusada');
  t := pg_temp.err(format('select pg_temp.fim_atend(%L)', l_nocity));
  rep := rep || pg_temp.chk(t like '%Informe a cidade e o estado%', 'o quiz NÃO conclui sem cidade e estado (resposta completa, mas sem local)');
  perform public.quiz_save_progress(l_nocity, 4, '{}'::jsonb, 'Ribeirão Preto', null);
  t := pg_temp.err(format('select pg_temp.fim_atend(%L)', l_nocity));
  rep := rep || pg_temp.chk(t like '%Informe a cidade e o estado%', 'só a cidade, sem estado, também não conclui');
  reset role;
  rep := rep || pg_temp.chk((select status from public.quiz_leads where id = l_nocity) <> 'completed', 'o lead sem local continua em andamento (não virou concluído)');

  -- ============ 3) mapa: contagens por estado batem com o que foi preenchido
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  g1 := public.quiz_lead_geo(null, null, null, null);
  rep := rep || pg_temp.chk(pg_temp.uf_n(g1, 'SP') - pg_temp.uf_n(g0, 'SP') = 2 and pg_temp.uf_n(g1, 'RJ') - pg_temp.uf_n(g0, 'RJ') = 1, 'mapa geral: +2 em SP (paciente e Academy) e +1 em RJ (parceiro)');
  rep := rep || pg_temp.chk((g1 ->> 'total')::int - (g0 ->> 'total')::int = 4 and (g1 ->> 'sem_localizacao')::int - (g0 ->> 'sem_localizacao')::int = 1, 'total +4 e +1 sem localização (o lead que informou a cidade mas não o estado)');
  g2 := public.quiz_lead_geo('academy', null, null, null);
  rep := rep || pg_temp.chk(pg_temp.uf_n(g2, 'SP') >= 1 and exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Campinas' and c ->> 'uf' = 'SP'), 'segmento Academy no mapa: Campinas/SP aparece');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' in ('Santo André', 'Niterói')), 'segmento Academy NÃO inclui o paciente nem o parceiro sem interesse no programa');
  g2 := public.quiz_lead_geo('partner', null, null, null);
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Niterói') and exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Campinas')
                            and not exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Santo André'), 'segmento Parceiro: Niterói e Campinas (a Academy também é parceria), sem o paciente');
  g2 := public.quiz_lead_geo('patient', null, null, null);
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Santo André' and c ->> 'uf' = 'SP') and not exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Niterói'), 'segmento Paciente: Santo André/SP, sem parceiros');
  g2 := public.quiz_lead_geo('patient', 'completed', null, 'pac.mapa.s26');
  rep := rep || pg_temp.chk((g2 ->> 'total')::int = 1, 'filtros de status e busca valem para o mapa também (1 resultado)');

  -- ============ 4) lista por segmento e por UF (e bate com o mapa)
  select count(*) into n from public.search_quiz_leads('academy', null, null, 'mapa.s26', null, 50, 0);
  rep := rep || pg_temp.chk(n = 1, 'lista do segmento Academy: 1 lead');
  select count(*) into n from public.search_quiz_leads('partner', null, null, 'mapa.s26', null, 50, 0);
  rep := rep || pg_temp.chk(n = 2, 'lista do segmento Parceiro: 2 leads (parceiro e Academy)');
  select count(*) into n from public.search_quiz_leads(null, null, null, 'mapa.s26', 'SP', 50, 0);
  select count(*) into n0 from public.search_quiz_leads(null, null, null, 'mapa.s26', null, 50, 0);
  rep := rep || pg_temp.chk(n = 2 and n0 = 4, 'lista filtrada por SP: 2 de 4 leads de teste');
  select count(*) into n from public.search_quiz_leads(null, null, null, 'mapa.s26', 'sp', 50, 0);
  rep := rep || pg_temp.chk(n = 2, 'UF em minúsculas na lista também filtra');
  rep := rep || pg_temp.chk((select bool_and(academy_interest) from public.search_quiz_leads('academy', null, null, 'mapa.s26', null, 50, 0)), 'a lista marca o interesse na Academy');
  rep := rep || pg_temp.chk(not exists (select 1 from public.search_quiz_leads('inexistente', null, null, 'mapa.s26', null, 50, 0)), 'segmento desconhecido não devolve nada');

  -- ============ 5) detalhe do lead mostra cidade e estado
  d := public.get_quiz_lead_detail(l_aca);
  rep := rep || pg_temp.chk(d ->> 'city' = 'Campinas' and d ->> 'state_uf' = 'SP', 'detalhe do lead traz cidade e estado preenchidos');
  reset role;

  -- ============ 6) permissões
  set local role authenticated; perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_lead_geo(null, null, null, null)') is null, 'comercial lê o mapa');
  select count(*) into n from public.search_quiz_leads(null, null, null, 'mapa.s26', null, 50, 0); rep := rep || pg_temp.chk(n = 4, 'comercial lê a lista da própria unidade');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_lead_geo(null, null, null, null)') like '42501%', 'fisioterapeuta NÃO lê o mapa');
  select count(*) into n from public.search_quiz_leads(null, null, null, 'mapa.s26', null, 50, 0); rep := rep || pg_temp.chk(n = 0, 'fisioterapeuta NÃO vê leads na lista');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.quiz_lead_geo(null, null, null, null)') is not null, 'anônimo NÃO lê o mapa');
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.search_quiz_leads(null, null, null, null, null, 5, 0)') is not null, 'anônimo NÃO lê a lista');
  reset role;

  raise exception E'RELATORIO_S26_MAPA_CAPTACAO_LEADS (transação desfeita):%', rep;
end $$;
