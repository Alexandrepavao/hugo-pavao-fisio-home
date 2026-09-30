-- RELEASE v1 — S07: jornada do paciente (objetivos, plano, avaliações, reavaliação, vídeos privados, renovação) e privacidade. Cobre a migration 058.
-- Transação sempre desfeita ao final (raise exception com o relatório). Somente Dev/teste.
do $$
declare
  v_org uuid; uz uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid();
  p1 uuid; p2 uuid; p3 uuid; prof uuid; svc uuid; prod uuid; cpk uuid; g1 uuid; plan1 uuid; plan3 uuid; asm uuid; vid1 uuid; vid2 uuid; rq1 uuid; rq2 uuid;
  j jsonb; d jsonb; n int; n2 int; ok boolean; rep text := ''; s text; r record;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S07)', 'teste-z-s07') returning id into uz;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s07.local'),(u_sales,'authenticated','authenticated','s@s07.local'),(u_phy,'authenticated','authenticated','ph1@s07.local'),
    (u_phy2,'authenticated','authenticated','ph2@s07.local'),(u_p1,'authenticated','authenticated','p1@s07.local'),(u_p2,'authenticated','authenticated','p2@s07.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Paciente S07 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Paciente S07 Dois') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Paciente S07 Tres') returning id into p3;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S07'),(u_sales, v_org, null, 'Comercial S07'),(u_phy, v_org, null, 'Fisio Um S07'),(u_phy2, v_org, null, 'Fisio Dois S07'),(u_p1, v_org, p1, 'Paciente Um'),(u_p2, v_org, p2, 'Paciente Dois');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', uz),(v_org, u_phy, 'physio', uz),(v_org, u_phy2, 'physio', uz),(v_org, u_p1, 'member', null),(v_org, u_p2, 'member', null);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio Um S07') returning id into prof;
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id, granted_by) values (v_org, uz, u_phy, p1, u_mgr),(v_org, uz, u_phy, p3, u_mgr);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S07', 30) returning id into svc;

  -- ============ 1) privacidade: administrativo e profissional sem vínculo NÃO leem dado clínico
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  g1 := public.patient_goal_save(p1, null, 'Voltar a correr 5 km sem dor', 'Objetivo combinado na avaliação', current_date + 60, 'active');
  rep := rep || format(E'\n[%s] fisioterapeuta com vínculo registra um objetivo', case when g1 is not null then 'OK' else 'FALHA' end);
  perform public.professional_assessment_add(p1, 'dor', 7, 'Dor ao subir escadas');
  foreach s in array array[u_mgr::text, u_sales::text, u_phy2::text, u_p1::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s::uuid, 'role','authenticated')::text, true);
    select count(*) into n from public.patient_goals; select count(*) into n2 from public.patient_assessments;
    rep := rep || format(E'\n[%s] leitura direta das tabelas clínicas negada para %s (objetivos=%s, avaliações=%s)', case when n = 0 and n2 = 0 then 'OK' else 'FALHA' end,
      case s::uuid when u_mgr then 'gestor' when u_sales then 'comercial' when u_phy2 then 'fisioterapeuta SEM vínculo' else 'o próprio paciente (lê só por my_journey)' end, n, n2);
  end loop;
  foreach s in array array[u_mgr::text, u_sales::text, u_phy2::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s::uuid, 'role','authenticated')::text, true);
    ok := false; begin perform public.professional_journey(p1); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] professional_journey negado para %s', case when ok then 'OK' else 'FALHA' end, case s::uuid when u_mgr then 'gestor' when u_sales then 'comercial' else 'fisioterapeuta sem vínculo' end);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  ok := false; begin perform public.patient_goal_save(p1, null, 'Tentativa sem vínculo'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta sem vínculo NÃO cria objetivo', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform public.patient_goal_save(p1, null, 'O paciente não define objetivo clínico'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente NÃO cria objetivo clínico (só o profissional vinculado)', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform private.journey_payload(p1, true); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] a função interna journey_payload não é chamável diretamente', case when ok then 'OK' else 'FALHA' end);

  -- ============ 2) objetivos
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.patient_goal_save(p1, null, 'ab'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] objetivo com título curto demais é recusado', case when ok then 'OK' else 'FALHA' end);
  perform public.patient_goal_save(p1, g1, 'Voltar a correr 5 km sem dor', null, null, 'achieved');
  select status, closed_at is not null into r from public.patient_goals where id = g1;
  rep := rep || format(E'\n[%s] objetivo alcançado guarda a data de encerramento', case when r.status = 'achieved' and r.closed_at then 'OK' else 'FALHA' end);

  -- ============ 3) plano: modelo padrão configurável; um plano ativo por paciente
  plan1 := public.patient_plan_save(p1, null, null, 'Plano inicial');
  select planned_sessions into n from public.patient_plans where id = plan1;
  rep := rep || format(E'\n[%s] plano sem quantidade usa o modelo padrão de 10 sessões (%s)', case when n = 10 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.journey_settings_set(12, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta NÃO altera a configuração do modelo', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  ok := false; begin perform public.journey_settings_set(0, null); exception when others then ok := true; end;
  perform public.journey_settings_set(12, '123456');
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  plan3 := public.patient_plan_save(p3, null, null, null);
  select planned_sessions into n from public.patient_plans where id = plan3;
  rep := rep || format(E'\n[%s] gestor muda o modelo para 12: o próximo plano nasce com 12 (o anterior não muda) e configuração inválida é recusada (%s)', case when n = 12 and ok then 'OK' else 'FALHA' end, n);
  perform public.patient_plan_save(p1, 8, null, 'Ajustado pela avaliação');
  select count(*), max(planned_sessions) into n, n2 from public.patient_plans where person_id = p1 and status = 'active';
  rep := rep || format(E'\n[%s] atualizar o plano mantém UM plano ativo e a quantidade é decisão do profissional (8) (%s plano, %s sessões)', case when n = 1 and n2 = 8 then 'OK' else 'FALHA' end, n, n2);
  ok := false; begin perform public.patient_plan_save(p1, 201); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] quantidade fora de 1–200 é recusada', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.patient_plan_save(p1, 8, gen_random_uuid()); exception when others then ok := sqlerrm like '%pacote inválido%'; end;
  rep := rep || format(E'\n[%s] plano não aceita pacote de outra pessoa/inexistente', case when ok then 'OK' else 'FALHA' end);

  -- ============ 4) sessões contadas SEPARADAMENTE (não são medida de melhora) + saldo do pacote à parte
  reset role;
  update public.patient_plans set started_on = current_date - 3 where id = plan1;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values (v_org, 'package', 'Pacote S07', 0, 4, svc) returning id into prod;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, uz, p1, prod, 4) returning id into cpk;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, cpk, 4, 'grant');
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
    (v_org, uz, prof, p1, svc, tstzrange(now() - interval '5 hours', now() - interval '4 hours'), 'attended'),
    (v_org, uz, prof, p1, svc, tstzrange(now() - interval '8 hours', now() - interval '7 hours'), 'no_show'),
    (v_org, uz, prof, p1, svc, tstzrange(now() - interval '11 hours', now() - interval '10 hours'), 'professional_no_show'),
    (v_org, uz, prof, p1, svc, tstzrange(now() - interval '14 hours', now() - interval '13 hours'), 'cancelled_by_patient'),
    (v_org, uz, prof, p1, svc, tstzrange(now() + interval '2 days', now() + interval '2 days' + interval '1 hour'), 'scheduled');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  j := public.my_journey();
  rep := rep || format(E'\n[%s] o plano conta separadamente: realizadas 1, faltas do paciente 1, ausência do profissional 1, canceladas 1', case when (j -> 'plan' ->> 'attended')::int = 1 and (j -> 'plan' ->> 'patient_no_show')::int = 1
      and (j -> 'plan' ->> 'professional_no_show')::int = 1 and (j -> 'plan' ->> 'cancelled')::int = 1 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] o saldo do pacote (4) é um dado à parte do plano (não é tratado como progresso) e há 1 consulta futura', case when (j ->> 'package_balance')::int = 4 and jsonb_array_length(j -> 'upcoming') = 1 then 'OK' else 'FALHA' end);

  -- ============ 5) avaliações: autoria, imutabilidade, intervalo
  asm := public.my_assessment_add('bem_estar', 6.5, 'Me sinto melhor nas escadas');
  j := public.my_journey();
  select count(*) filter (where x ->> 'by_role' = 'patient' and x ->> 'author' = 'Paciente'), count(*) filter (where x ->> 'by_role' = 'professional' and x ->> 'author' = 'Fisio Um S07')
    into n, n2 from jsonb_array_elements(j -> 'assessments') x;
  rep := rep || format(E'\n[%s] avaliações trazem data e autoria: 1 do paciente e 1 do profissional identificado (%s / %s)', case when n = 1 and n2 = 1 then 'OK' else 'FALHA' end, n, n2);
  ok := false; begin perform public.my_assessment_add('dor', 11); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] nota fora de 0–10 é recusada', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.my_assessment_add('humor', 5); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] tipo de avaliação desconhecido é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin update public.patient_assessments set score = 1 where id = asm; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente NÃO altera avaliação (registro imutável)', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin delete from public.patient_assessments where id = asm; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] nem o profissional apaga avaliação (correção = novo registro)', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.professional_assessment_add(p1, 'dor', 3, null, now() + interval '2 days'); exception when others then ok := sqlerrm like '%futuro%'; end;
  rep := rep || format(E'\n[%s] avaliação com data futura é recusada', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role','authenticated')::text, true);
  j := public.my_journey();
  rep := rep || format(E'\n[%s] outro paciente NÃO vê a jornada do paciente 1 (0 objetivos, 0 avaliações, sem plano)', case when jsonb_array_length(j -> 'goals') = 0 and jsonb_array_length(j -> 'assessments') = 0 and (j -> 'plan') = 'null'::jsonb then 'OK' else 'FALHA' end);

  -- ============ 6) reavaliação: continuidade, manutenção, alta; nota clínica restrita
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.patient_reassess(p1, 'continuidade', null); exception when others then ok := sqlerrm like '%sessões adicionais%'; end;
  rep := rep || format(E'\n[%s] continuidade exige as sessões adicionais', case when ok then 'OK' else 'FALHA' end);
  perform public.patient_reassess(p1, 'continuidade', 4, 'Vamos manter o foco na força', 'Boa resposta à carga progressiva');
  select planned_sessions into n from public.patient_plans where id = plan1;
  rep := rep || format(E'\n[%s] continuidade soma sessões ao plano (8 + 4 = 12) e não cria cobrança (%s)', case when n = 12 then 'OK' else 'FALHA' end, n);
  perform public.patient_reassess(p1, 'manutencao', null, 'Agora só manutenção', null);
  select maintenance into ok from public.patient_plans where id = plan1;
  rep := rep || format(E'\n[%s] manutenção marca o plano como de manutenção', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  j := public.my_journey();
  select count(*) into n from jsonb_array_elements(j -> 'reassessments') x where x ? 'clinical_note';
  rep := rep || format(E'\n[%s] o paciente vê a decisão e a mensagem, mas NUNCA a nota clínica (%s reavaliações, %s com nota)', case when jsonb_array_length(j -> 'reassessments') = 2 and n = 0 then 'OK' else 'FALHA' end, jsonb_array_length(j -> 'reassessments'), n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  d := public.professional_journey(p1);
  select count(*) into n from jsonb_array_elements(d -> 'reassessments') x where x ->> 'clinical_note' is not null;
  rep := rep || format(E'\n[%s] o profissional vinculado vê a nota clínica (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform public.patient_reassess(p1, 'alta', null, 'Alta! Parabéns pelo esforço.', null);
  select status, closed_at is not null into r from public.patient_plans where id = plan1;
  rep := rep || format(E'\n[%s] alta encerra o plano (status %s)', case when r.status = 'completed' and r.closed_at then 'OK' else 'FALHA' end, r.status);
  ok := false; begin perform public.patient_reassess(p1, 'alta'); exception when others then ok := sqlerrm like '%plano ativo%'; end;
  rep := rep || format(E'\n[%s] depois da alta não há plano ativo para reavaliar', case when ok then 'OK' else 'FALHA' end);

  -- ============ 7) vídeos privados
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.journey_settings_set(12, null);           -- sem biblioteca padrão
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.patient_video_assign(p1, 'Exercício de ponte', null, null, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'); exception when others then ok := sqlerrm like '%biblioteca%'; end;
  rep := rep || format(E'\n[%s] sem biblioteca Bunny (nem padrão) a atribuição é recusada com mensagem clara', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.patient_video_assign(p1, 'Exercício de ponte', null, '123456', 'id inválido!'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] ID de vídeo com formato inválido é recusado', case when ok then 'OK' else 'FALHA' end);
  vid1 := public.patient_video_assign(p1, 'Exercício de ponte', 'Três séries de 10', '123456', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  vid2 := public.patient_video_assign(p1, 'Vídeo com validade', null, '123456', 'b1b2c3d4-e5f6-7890-abcd-ef1234567890', now() + interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  j := public.my_journey();
  select count(*) into n from jsonb_array_elements(j -> 'videos') x where x ? 'bunny_video_id' or x ? 'bunny_library_id' or x ? 'library_id';
  rep := rep || format(E'\n[%s] o paciente vê os 2 vídeos atribuídos, mas os identificadores do Bunny NÃO vão para o navegador (%s com ids)', case when jsonb_array_length(j -> 'videos') = 2 and n = 0 then 'OK' else 'FALHA' end, n);
  select library_id, bunny_video_id into r from public.video_playback_authorize(vid1);
  rep := rep || format(E'\n[%s] o paciente dono recebe autorização de reprodução (biblioteca %s)', case when r.library_id = '123456' and r.bunny_video_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' then 'OK' else 'FALHA' end, r.library_id);
  foreach s in array array[u_p2::text, u_phy2::text, u_mgr::text, u_sales::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s::uuid, 'role','authenticated')::text, true);
    ok := false; begin perform * from public.video_playback_authorize(vid1); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] reprodução negada para %s', case when ok then 'OK' else 'FALHA' end, case s::uuid when u_p2 then 'outro paciente' when u_phy2 then 'fisioterapeuta sem vínculo' when u_mgr then 'gestor' else 'comercial' end);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  perform * from public.video_playback_authorize(vid1);
  d := public.professional_journey(p1);
  select (x ->> 'views')::int into n from jsonb_array_elements(d -> 'videos') x where x ->> 'id' = vid1::text;
  rep := rep || format(E'\n[%s] o profissional vinculado também autoriza (pré-visualização) e as visualizações DO PACIENTE são contadas à parte (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  reset role; select count(*) into n from public.video_access_log where video_id = vid1; set local role authenticated;
  rep := rep || format(E'\n[%s] cada autorização é registrada no log de acesso (paciente + profissional = %s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  perform public.patient_video_revoke(vid1);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform * from public.video_playback_authorize(vid1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] vídeo revogado deixa de reproduzir e some da jornada do paciente (%s vídeo(s) restante(s))', case when ok and jsonb_array_length((public.my_journey()) -> 'videos') = 1 then 'OK' else 'FALHA' end, jsonb_array_length((public.my_journey()) -> 'videos'));
  reset role; update public.patient_videos set expires_at = now() - interval '1 minute' where id = vid2; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform * from public.video_playback_authorize(vid2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] vídeo com validade vencida é negado', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  ok := false; begin perform public.patient_video_revoke(vid2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta sem vínculo NÃO revoga vídeo de outro', case when ok then 'OK' else 'FALHA' end);

  -- ============ 8) pedido de renovação/contato: sem cobrança, sem consumo, sem duplicar
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_renewal_request('cobranca'); exception when others then ok := true; end;
  rq1 := public.my_renewal_request('renovacao', 'Quero continuar com o tratamento');
  rq2 := public.my_renewal_request('renovacao', 'Clique repetido');
  reset role; select count(*) into n from public.renewal_requests where person_id = p1; select count(*) into n2 from public.crm_tasks where dedupe_key = 'renewal:' || rq1::text;
  rep := rep || format(E'\n[%s] pedido repetido reaproveita o mesmo pedido aberto: 1 pedido e 1 tarefa para a equipe (%s / %s); tipo inválido é recusado', case when rq1 = rq2 and n = 1 and n2 = 1 and ok then 'OK' else 'FALHA' end, n, n2);
  select count(*) into n from public.sales where person_id = p1; select coalesce(sum(delta), 0) into n2 from public.session_ledger where client_package_id = cpk;
  rep := rep || format(E'\n[%s] o pedido NÃO cria venda nem cobrança e NÃO mexe no saldo de sessões (vendas=%s, saldo do pacote=%s)', case when n = 0 and n2 = 4 then 'OK' else 'FALHA' end, n, n2);
  set local role authenticated;
  foreach s in array array[u_mgr::text, u_sales::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s::uuid, 'role','authenticated')::text, true);
    select count(*) into n from public.renewal_requests_open() where person_id = p1;
    rep := rep || format(E'\n[%s] %s vê o pedido na fila administrativa (sem dado clínico)', case when n = 1 then 'OK' else 'FALHA' end, case s::uuid when u_mgr then 'gestor' else 'comercial da unidade' end);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  select count(*) into n from public.renewal_requests_open();
  ok := false; begin perform public.renewal_request_set_status(rq1, 'closed'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta sem vínculo não vê nem trata pedidos (%s na fila)', case when n = 0 and ok then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform public.renewal_request_set_status(rq1, 'closed'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] o paciente não trata o próprio pedido', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  perform public.renewal_request_set_status(rq1, 'contacted');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  rq2 := public.my_renewal_request('contato', 'Novo pedido depois do atendimento anterior');
  rep := rep || format(E'\n[%s] depois de contatado, um novo pedido é um novo registro', case when rq2 <> rq1 then 'OK' else 'FALHA' end);

  -- ============ 9) superfície pública
  reset role; set local role anon;
  foreach s in array array['my_journey','journey_settings_get','renewal_requests_open'] loop
    ok := false; begin execute format('select * from public.%I()', s); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] anon não executa %s', case when ok then 'OK' else 'FALHA' end, s);
  end loop;
  ok := false; begin perform public.professional_journey(p1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa professional_journey', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform * from public.video_playback_authorize(vid1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não autoriza reprodução de vídeo', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.my_renewal_request('contato'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não pede renovação', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S07_JORNADA_PACIENTE (transação desfeita):%', rep;
end $$;
