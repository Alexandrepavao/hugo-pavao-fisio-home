-- RELEASE v1 — S27: o que a pessoa preencheu nos formulários aparece no cadastro/CRM, e a Distribuição geográfica do CRM (migration 088). Transação sempre desfeita. Somente Dev/teste.
--  · cidade/UF digitadas no quiz preenchem o cadastro da pessoa (só se ela ainda não tem local; nunca trocam um dado já cadastrado)
--  · person_form_answers: respostas do quiz e do formulário de página; saúde oculta para o comercial; sem papel = recusado
--  · crm_geo_distribution: contatos do CRM por estado/cidade e por tipo de lead (funil); cada contato uma vez; escopo e permissões
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.27.0.' || n)::text, true); end $$;
create or replace function pg_temp.uf_n(g jsonb, uf text) returns int language sql as $$ select coalesce((select (x ->> 'count')::int from jsonb_array_elements(g -> 'by_state') x where x ->> 'uf' = uf), 0) $$;
do $$
declare
  v_org uuid; v_unit uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  rep text := ''; res jsonb; l_par uuid; l_pac uuid; l_old uuid; per_par uuid; per_pac uuid; per_old uuid; fa jsonb; fb jsonb; g0 jsonb; g1 jsonb; g2 jsonb;
  v_pipe uuid; pg uuid; fm uuid; r jsonb; n bigint; q jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org order by created_at limit 1;
  select id into v_pipe from public.pipelines where org_id = v_org and kind = 'patients';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s27.local'),(u_sales,'authenticated','authenticated','s@s27.local'),(u_phy,'authenticated','authenticated','p@s27.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S27'),(u_sales, v_org, null, 'Comercial S27'),(u_phy, v_org, null, 'Fisio S27');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_unit),(v_org, u_phy, 'physio', v_unit);

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  g0 := public.crm_geo_distribution('partners', null);
  reset role;

  -- ============ 1) quiz de parceria (como a Vanessa) e quiz de paciente; um terceiro contato que já tinha local cadastrado
  perform pg_temp.as_anon(1); set local role anon;
  res := public.quiz_start('parceria', 'Vanessa Exemplo S27', 'vanessa.s27@example.com', '(19) 98888-2701', 'contact-v1', '/trabalhe-conosco', 'trabalhe-conosco', null, '{}'::jsonb, null); l_par := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(l_par, 4, '{}'::jsonb, '  Campinas ', 'sp');
  perform public.quiz_save_progress(l_par, 5, jsonb_build_object('momento_profissional', jsonb_build_object('value','em_atuacao','label','Fisioterapeuta em atuação'), 'situacao_registro', jsonb_build_object('value','ativo','label','Ativo'),
    'area_atuacao', jsonb_build_object('value','geriatrica','label','Geriátrica'), 'modelo_atendimento', jsonb_build_object('value','domiciliar','label','Atendimento domiciliar'),
    'objetivos_parceria', jsonb_build_object('value', jsonb_build_array('equipe'), 'label','Atuar na equipe'), 'interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('nenhuma'), 'label','Nenhuma no momento')));
  perform public.quiz_save_progress(l_par, 11, jsonb_build_object('interesse_programa_clinica', jsonb_build_object('value','nao_momento','label','Não neste momento')));
  perform public.quiz_complete(l_par, false, null);
  res := public.quiz_start('atendimento', 'Paciente Exemplo S27', 'pac.s27@example.com', '(11) 98888-2702', 'contact-v1', '/', '/avaliacao', null, '{}'::jsonb, null); l_pac := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(l_pac, 4, '{}'::jsonb, 'Santo André', 'SP');
  perform public.quiz_set_health_consent(l_pac, 'health-v1');
  perform public.quiz_save_progress(l_pac, 7, jsonb_build_object('dor_intensidade', jsonb_build_object('value','6','label','6'), 'motivacao_melhora', jsonb_build_object('value','8','label','8'), 'impacto_qualidade_vida', jsonb_build_object('value','9','label','9'), 'atividade_desejada', jsonb_build_object('value','trabalhar','label','Trabalhar')));
  perform public.quiz_save_progress(l_pac, 10, jsonb_build_object('interesse_acompanhamento', jsonb_build_object('value','sim','label','Sim'), 'faixa_investimento', jsonb_build_object('value','ate_250','label','Até R$ 250')));
  perform public.quiz_complete(l_pac, false, null);
  reset role;
  select person_id into per_par from public.quiz_leads where id = l_par; select person_id into per_pac from public.quiz_leads where id = l_pac;

  rep := rep || pg_temp.chk((select city from public.people where id = per_par) = 'Campinas' and (select state_uf from public.people where id = per_par) = 'SP', 'cidade/UF do quiz preenchem o cadastro (Campinas/SP, sem espaços e UF em maiúsculas)');
  rep := rep || pg_temp.chk((select city from public.people where id = per_pac) = 'Santo André' and (select state_uf from public.people where id = per_pac) = 'SP', 'o mesmo vale para o paciente');

  -- pessoa que já tem local cadastrado: o quiz NÃO troca
  update public.people set city = 'Curitiba', state_uf = 'PR' where id = per_pac;
  set local role anon; perform pg_temp.as_anon(1);
  res := public.quiz_start('atendimento', 'Antigo Exemplo S27', 'antigo.s27@example.com', '(11) 98888-2703', 'contact-v1', '/', '/avaliacao', null, '{}'::jsonb, null); l_old := (res ->> 'id')::uuid;
  reset role; select person_id into per_old from public.quiz_leads where id = l_old;
  update public.people set city = 'Maringá', state_uf = 'PR' where id = per_old;
  set local role anon; perform pg_temp.as_anon(1);
  perform public.quiz_save_progress(l_old, 4, '{}'::jsonb, 'Recife', 'PE');
  reset role;
  rep := rep || pg_temp.chk((select city from public.people where id = per_old) = 'Maringá' and (select state_uf from public.people where id = per_old) = 'PR', 'cadastro que já tinha local (Maringá/PR) NÃO é trocado pelo quiz (Recife/PE)');
  rep := rep || pg_temp.chk((select city from public.quiz_leads where id = l_old) = 'Recife', 'o quiz continua guardando o que a pessoa digitou (Recife)');

  -- ============ 2) formulário de página (público) → cadastro
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  pg := public.page_create('s27-form', 'Formulário S27', 'checkup', '[{"type":"hero","title":"S27"},{"type":"form","form_id":"__DEFAULT_FORM__"}]'::jsonb, v_unit, v_pipe);
  select id into fm from public.forms where page_id = pg; perform public.page_publish(pg);
  reset role; perform pg_temp.as_anon(2); set local role anon;
  r := public.submit_public_form(fm, '{"name":"Maria Form S27","phone":"(11) 97777-2704","email":"maria.form.s27@example.com"}', '{}');
  reset role;
  rep := rep || pg_temp.chk(r ->> 'status' = 'created', 'formulário de página recebido (' || coalesce(r ->> 'status', '?') || ')');

  -- ============ 3) person_form_answers
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  fa := public.person_form_answers(per_par);
  rep := rep || pg_temp.chk(jsonb_array_length(fa -> 'quiz') = 1 and fa -> 'quiz' -> 0 ->> 'city' = 'Campinas' and fa -> 'quiz' -> 0 ->> 'state_uf' = 'SP', 'gestor vê o quiz da pessoa com cidade e UF');
  rep := rep || pg_temp.chk(fa -> 'quiz' -> 0 -> 'answers' -> 'situacao_registro' ->> 'label' = 'Ativo' and fa -> 'quiz' -> 0 -> 'answers' -> 'area_atuacao' ->> 'label' = 'Geriátrica'
                            and fa -> 'quiz' -> 0 -> 'answers' -> 'interesse_programa_clinica' ->> 'label' = 'Não neste momento', 'respostas completas: registro ativo, área geriátrica, sem interesse na clínica no momento');
  fb := public.person_form_answers(per_pac);
  rep := rep || pg_temp.chk(fb -> 'quiz' -> 0 -> 'answers' ? 'dor_intensidade' and (fb -> 'quiz' -> 0 ->> 'health_answers_restricted')::boolean = false, 'gestor vê também as respostas de saúde');
  select public.person_form_answers(p.id) into q from public.people p join public.person_contacts c on c.person_id = p.id where c.normalized = 'maria.form.s27@example.com' limit 1;
  rep := rep || pg_temp.chk(jsonb_array_length(q -> 'forms') = 1 and q -> 'forms' -> 0 ->> 'form_name' is not null
                            and exists (select 1 from jsonb_array_elements(q -> 'forms' -> 0 -> 'fields') f where f ->> 'value' = '(11) 97777-2704'), 'formulário de página: nome do formulário e campos preenchidos com seus rótulos');
  rep := rep || pg_temp.chk(jsonb_array_length(public.person_form_answers(gen_random_uuid()) -> 'quiz') = 0, 'pessoa sem formulário: listas vazias (sem erro)');

  perform pg_temp.as_user(u_sales);
  fb := public.person_form_answers(per_pac);
  rep := rep || pg_temp.chk(not (fb -> 'quiz' -> 0 -> 'answers' ? 'dor_intensidade') and (fb -> 'quiz' -> 0 ->> 'health_answers_restricted')::boolean and fb -> 'quiz' -> 0 -> 'answers' ? 'faixa_investimento', 'comercial vê as respostas, mas NÃO as de saúde');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_form_answers(%L)', per_par)) like '42501%', 'fisioterapeuta NÃO lê as respostas dos formulários');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_form_answers(%L)', per_par)) is not null, 'anônimo NÃO lê as respostas dos formulários');
  reset role;

  -- ============ 4) Distribuição geográfica do CRM
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  g1 := public.crm_geo_distribution('partners', null);
  rep := rep || pg_temp.chk((g1 ->> 'total')::int - (g0 ->> 'total')::int = 1 and pg_temp.uf_n(g1, 'SP') - pg_temp.uf_n(g0, 'SP') = 1, 'CRM › parceiros: +1 contato (Vanessa), em SP');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(g1 -> 'by_city') c where c ->> 'city' = 'Campinas' and c ->> 'uf' = 'SP'), 'CRM › parceiros: Campinas/SP aparece nas cidades');
  g2 := public.crm_geo_distribution('patients', null);
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Curitiba' and c ->> 'uf' = 'PR') and exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Maringá'), 'CRM › pacientes: usa o local do cadastro (Curitiba, Maringá), não o digitado no quiz');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(g2 -> 'by_city') c where c ->> 'city' = 'Campinas'), 'CRM › pacientes: não mistura o parceiro');
  g2 := public.crm_geo_distribution(null, null);
  rep := rep || pg_temp.chk((g2 ->> 'total')::int >= (g1 ->> 'total')::int and (g2 ->> 'sem_localizacao')::int >= 1, 'CRM › todos: total, e a Maria (formulário de página, sem local) conta em "sem localização"');
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(g2 -> 'by_state') s) = (select count(distinct x ->> 'uf') from jsonb_array_elements(g2 -> 'by_state') x), 'cada estado aparece uma vez');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.crm_geo_distribution(null, null)') is null, 'comercial lê a distribuição do CRM');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select public.crm_geo_distribution(null, null)') like '42501%', 'fisioterapeuta NÃO lê a distribuição do CRM');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.crm_geo_distribution(null, null)') is not null, 'anônimo NÃO lê a distribuição do CRM');
  reset role;

  raise exception E'RELATORIO_S27_DADOS_FORMULARIO_GEO_CRM (transação desfeita):%', rep;
end $$;
