-- Quizzes de captação (atendimento/parceria): quiz_start/save_progress/set_health_consent/complete/
-- log_whatsapp_click, integração ao CRM (funil correto, "Quiz iniciado"/"Quiz concluído", tarefa),
-- segmento Potencial Academy (tag, sem matrícula/papel/oportunidade extra), idempotência same-day,
-- gate de consentimento de saúde, revisão de duplicidade, mascaramento de respostas de saúde para o
-- papel comercial, RLS bloqueando leitura direta anônima. Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_unit uuid; rep text := '';
  u_mgr uuid; u_sales uuid;
  v_id uuid; v_id2 uuid; v_res jsonb; v_detail jsonb;
  v_pipe_patients uuid; v_pipe_partners uuid;
  ok boolean; n int; v_num text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org limit 1;
  select id into v_pipe_patients from public.pipelines where org_id = v_org and kind = 'patients';
  select id into v_pipe_partners from public.pipelines where org_id = v_org and kind = 'partners';

  u_mgr := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'lq.mgr@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_mgr, v_org, 'LQ Gestora');
  insert into public.role_assignments (org_id, user_id, role) values (v_org, u_mgr, 'manager');

  u_sales := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (u_sales, 'authenticated', 'authenticated', 'lq.sales@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_sales, v_org, 'LQ Comercial');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_sales, 'sales', v_unit);

  -- ---------- RLS: anon não lê quiz_leads diretamente (só pelas funções)
  set local role anon;
  begin perform count(*) from public.quiz_leads; ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] anon não consegue ler a tabela quiz_leads diretamente (só pelas RPCs)', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- jornada de atendimento: início cria pessoa + oportunidade no funil "Pacientes"
  set local role anon;
  v_res := public.quiz_start('atendimento', 'LQ Paciente Teste', 'lq.paciente@t.local', '11999990001', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null);
  v_id := (v_res ->> 'id')::uuid;
  reset role;
  select count(*) into n from public.opportunities o join public.quiz_leads l on l.opportunity_id = o.id where l.id = v_id and o.pipeline_id = v_pipe_patients;
  rep := rep || format(E'\n[%s] quiz_start (atendimento) cria pessoa + oportunidade no funil Pacientes', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.interactions i join public.quiz_leads l on l.opportunity_id = i.opportunity_id where l.id = v_id and i.summary like 'Quiz iniciado%';
  rep := rep || format(E'\n[%s] "Quiz iniciado" registrado em interactions', case when n = 1 then 'OK' else 'FALHA' end);

  -- ---------- perguntas de saúde bloqueadas sem consentimento específico
  set local role anon;
  begin perform public.quiz_save_progress(v_id, 5, jsonb_build_object('dor_intensidade', jsonb_build_object('value', '7', 'label', 'Dor'))); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] resposta de saúde é rejeitada antes do consentimento específico', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- resposta com valor fora do domínio permitido é rejeitada
  set local role anon;
  begin perform public.quiz_save_progress(v_id, 9, jsonb_build_object('faixa_investimento', jsonb_build_object('value', 'gratis', 'label', 'Grátis'))); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] valor fora do domínio permitido (faixa_investimento) é rejeitado', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- fluxo completo até a conclusão
  set local role anon;
  perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'São Paulo', 'SP');
  perform public.quiz_set_health_consent(v_id, 'health-v1');
  perform public.quiz_save_progress(v_id, 7, jsonb_build_object(
    'dor_intensidade', jsonb_build_object('value', '6', 'label', 'Dor'),
    'motivacao_melhora', jsonb_build_object('value', '8', 'label', 'Motivação'),
    'impacto_qualidade_vida', jsonb_build_object('value', '9', 'label', 'Qualidade de vida'),
    'atividade_desejada', jsonb_build_object('value', 'trabalhar', 'label', 'Trabalhar')
  ));
  perform public.quiz_save_progress(v_id, 10, jsonb_build_object(
    'interesse_acompanhamento', jsonb_build_object('value', 'sim', 'label', 'Sim'),
    'faixa_investimento', jsonb_build_object('value', 'ate_250', 'label', 'Até R$ 250')
  ));
  v_res := public.quiz_complete(v_id, true, 'marketing-v1');
  reset role;
  rep := rep || format(E'\n[%s] quiz_complete retorna status concluído + protocolo (%s)', case when v_res ->> 'status' = 'completed' and v_res ->> 'protocol' is not null then 'OK' else 'FALHA' end, v_res ->> 'protocol');
  select count(*) into n from public.interactions i join public.quiz_leads l on l.opportunity_id = i.opportunity_id where l.id = v_id and i.summary like 'Quiz concluído%';
  rep := rep || format(E'\n[%s] "Quiz concluído — aguardando contato" registrado', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.crm_tasks where dedupe_key = 'quiz_lead:' || v_id;
  rep := rep || format(E'\n[%s] tarefa de primeiro contato criada (idempotente por dedupe_key)', case when n = 1 then 'OK' else 'FALHA' end);

  -- ---------- idempotência: reenvio no mesmo dia retoma a MESMA submissão (não duplica pessoa/oportunidade)
  set local role anon;
  v_res := public.quiz_start('atendimento', 'LQ Paciente Teste', 'lq.paciente@t.local', '11999990001', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null);
  reset role;
  rep := rep || format(E'\n[%s] reenvio no mesmo dia retoma a mesma submissão (resumed=%s, mesmo id=%s)', case when (v_res ->> 'resumed')::boolean and (v_res ->> 'id')::uuid = v_id then 'OK' else 'FALHA' end, v_res ->> 'resumed', (v_res ->> 'id')::uuid = v_id);

  -- ---------- honeypot: preenchido = resposta fantasma, nada é gravado
  set local role anon;
  v_res := public.quiz_start('atendimento', 'Bot Teste', 'bot@t.local', '11999990002', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, 'preenchido-por-robo');
  reset role;
  select count(*) into n from public.quiz_leads where email = 'bot@t.local';
  rep := rep || format(E'\n[%s] honeypot preenchido não grava nada (resposta fantasma devolvida)', case when n = 0 and v_res ->> 'id' is not null then 'OK' else 'FALHA' end);

  -- ---------- conflito de contato com pessoa de nome bem diferente: cria pessoa nova e sinaliza revisão
  declare v_existing uuid; begin
    insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, 'Zeta Completamente Diferente') returning id into v_existing;
    insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, v_existing, 'phone', private.norm_phone('11999990003'), true);
  end;
  set local role anon;
  v_res := public.quiz_start('atendimento', 'Beta Outro Nome', 'beta.outro@t.local', '11999990003', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null);
  v_id2 := (v_res ->> 'id')::uuid;
  reset role;
  select needs_review into ok from public.quiz_leads where id = v_id2;
  rep := rep || format(E'\n[%s] telefone compartilhado com nome bem diferente cria pessoa nova e marca needs_review', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.crm_tasks where dedupe_key like 'dedupe:%' and person_id = (select person_id from public.quiz_leads where id = v_id2);
  rep := rep || format(E'\n[%s] tarefa de revisão de duplicidade criada', case when n = 1 then 'OK' else 'FALHA' end);

  -- ---------- jornada de parceria: funil "Parceiros" + segmento Potencial Academy (tag, sem oportunidade extra)
  set local role anon;
  v_res := public.quiz_start('parceria', 'LQ Parceiro Teste', 'lq.parceiro@t.local', '11999990004', 'contact-v1', '/trabalhe-conosco', '/seja-parceiro', '', '{}'::jsonb, null);
  v_id2 := (v_res ->> 'id')::uuid;
  perform public.quiz_save_progress(v_id2, 4, '{}'::jsonb, 'Campinas', 'SP');
  perform public.quiz_save_progress(v_id2, 9, jsonb_build_object(
    'momento_profissional', jsonb_build_object('value', 'estudante', 'label', 'Estudante'),
    'situacao_registro', jsonb_build_object('value', 'nao_possuo', 'label', 'Ainda não possuo'),
    'area_atuacao', jsonb_build_object('value', 'ortopedia', 'label', 'Ortopedia'),
    'modelo_atendimento', jsonb_build_object('value', 'nao_atendo', 'label', 'Ainda não atendo'),
    'objetivos_parceria', jsonb_build_object('value', jsonb_build_array('conhecer_metodo'), 'label', 'Conhecer o método de atendimento')
  ));
  perform public.quiz_save_progress(v_id2, 10, jsonb_build_object(
    'interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('precificacao', 'vendas'), 'label', 'Precificação, Vendas')
  ));
  v_res := public.quiz_complete(v_id2, false, null);
  reset role;
  select count(*) into n from public.opportunities o join public.quiz_leads l on l.opportunity_id = o.id where l.id = v_id2 and o.pipeline_id = v_pipe_partners;
  rep := rep || format(E'\n[%s] quiz de parceria cria oportunidade no funil Parceiros', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.person_tags pt join public.tags t on t.id = pt.tag_id join public.quiz_leads l on l.person_id = pt.person_id
    where l.id = v_id2 and t.name = 'Potencial Academy';
  rep := rep || format(E'\n[%s] fisioterapeuta captado ganha a tag "Potencial Academy" (sem matrícula/papel/oportunidade extra)', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.opportunities where person_id = (select person_id from public.quiz_leads where id = v_id2);
  rep := rep || format(E'\n[%s] segmento Academy não cria uma segunda oportunidade (só 1 oportunidade para a pessoa)', case when n = 1 then 'OK' else 'FALHA' end);

  -- ---------- multi-seleção com valor exclusivo: "Nenhuma" combinada com outra opção é rejeitada
  -- (usa uma submissão nova — a anterior já está "completed" e quiz_save_progress vira no-op nesse caso)
  declare v_multi uuid; begin
    set local role anon;
    v_res := public.quiz_start('parceria', 'LQ Multi Teste', 'lq.multi@t.local', '11999990006', 'contact-v1', '/', '/seja-parceiro', '', '{}'::jsonb, null);
    v_multi := (v_res ->> 'id')::uuid;
    begin
      perform public.quiz_save_progress(v_multi, 10, jsonb_build_object('interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('nenhuma', 'vendas'), 'label', 'x')));
      ok := true;
    exception when others then ok := false; end;
    reset role;
    rep := rep || format(E'\n[%s] "Nenhuma" combinada com outra opção em interesses_desenvolvimento é rejeitada (exclusiva)', case when not ok then 'OK' else 'FALHA' end);
  end;

  -- ---------- visão administrativa: respostas de saúde mascaradas para "sales", visíveis para "manager"
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.list_quiz_leads('atendimento', null, null, 'LQ Paciente Teste', 10, 0) r where r.id = v_id;
  v_detail := public.get_quiz_lead_detail(v_id);
  reset role;
  rep := rep || format(E'\n[%s] papel comercial (sales) enxerga a captação na lista (n=%s) mas NÃO vê respostas de saúde', case when n = 1 and (v_detail ->> 'health_answers_restricted')::boolean and not (v_detail -> 'answers' ? 'dor_intensidade') then 'OK' else 'FALHA' end, n);

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_detail := public.get_quiz_lead_detail(v_id);
  reset role;
  rep := rep || format(E'\n[%s] gestor (manager) vê as respostas de saúde completas', case when not (v_detail ->> 'health_answers_restricted')::boolean and (v_detail -> 'answers' ? 'dor_intensidade') then 'OK' else 'FALHA' end);

  -- ---------- número de WhatsApp configurado por jornada (nunca inventado — vem da tabela seedada)
  select public.quiz_whatsapp_number('atendimento', null) into v_num;
  rep := rep || format(E'\n[%s] número de WhatsApp configurado para atendimento (%s)', case when v_num = '5511959075351' then 'OK' else 'FALHA' end, v_num);
  select public.quiz_whatsapp_number('parceria', null) into v_num;
  rep := rep || format(E'\n[%s] número de WhatsApp configurado para parceria (%s)', case when v_num = '5511913634424' then 'OK' else 'FALHA' end, v_num);

  -- ---------- clique no WhatsApp só é aceito para submissão concluída, e é separado da conclusão
  declare v_incomplete uuid; begin
    set local role anon;
    v_res := public.quiz_start('atendimento', 'LQ Incompleto Teste', 'lq.incompleto@t.local', '11999990005', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null);
    v_incomplete := (v_res ->> 'id')::uuid;
    begin perform public.quiz_log_whatsapp_click(v_incomplete); ok := true; exception when others then ok := false; end;
    reset role;
    rep := rep || format(E'\n[%s] clique no WhatsApp é rejeitado para submissão ainda não concluída', case when not ok then 'OK' else 'FALHA' end);
  end;
  set local role anon;
  perform public.quiz_log_whatsapp_click(v_id2);
  reset role;
  select whatsapp_clicked_at is not null into ok from public.quiz_leads where id = v_id2;
  rep := rep || format(E'\n[%s] clique no WhatsApp registrado separadamente da conclusão', case when ok then 'OK' else 'FALHA' end);

  raise exception E'RELATORIO_LEAD_QUIZZES (transação desfeita):%', rep;
end $$;
