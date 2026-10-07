-- RELEASE v1 — S19: central de Conversas (migration 077): abertura idempotente, permissões (unidade e papel), multiatendimento (entrar, adicionar, transferir, sair),
-- mensagens (recebida/enviada/nota; imutáveis; só a enviada entra no histórico do lead), não lidas, mensagens agendadas (lembrete + registro; nada é enviado sozinho),
-- ficha do lead por nicho (campos válidos por funil, nada fora do nicho). Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; pipe_pat uuid; pipe_edu uuid; pipe_par uuid; pipe_cus uuid; st_pat uuid; st_edu uuid; st_par uuid; st_cus uuid;
  u_mgr uuid := gen_random_uuid(); u_s1 uuid := gen_random_uuid(); u_s2 uuid := gen_random_uuid(); u_s3 uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_pat uuid := gen_random_uuid();
  p_ana uuid; p_bia uuid; p_cli uuid; p_dan uuid; o_ana uuid; o_bia uuid; o_cli uuid; o_cus uuid; c_ana uuid; c_ana2 uuid; c_bia uuid; m1 uuid; m2 uuid; m3 uuid; m4 uuid;
  sch1 uuid; sch2 uuid; sch3 uuid; task1 uuid; n bigint; n2 bigint; t text; j jsonb; x record; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S19)', 'teste-a-s19') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S19)', 'teste-b-s19') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s19.local'),(u_s1,'authenticated','authenticated','s1@s19.local'),(u_s2,'authenticated','authenticated','s2@s19.local'),
    (u_s3,'authenticated','authenticated','s3@s19.local'),(u_phy,'authenticated','authenticated','ph@s19.local'),(u_pat,'authenticated','authenticated','pt@s19.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S19'),(u_s1, v_org, null, 'Comercial Um'),(u_s2, v_org, null, 'Comercial Dois'),
    (u_s3, v_org, null, 'Comercial Unidade B'),(u_phy, v_org, null, 'Fisio S19'),(u_pat, v_org, null, 'Paciente S19');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_s1, 'sales', ua),(v_org, u_s2, 'sales', ua),(v_org, u_s3, 'sales', ub),(v_org, u_phy, 'physio', ua);
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Pacientes S19', 'patients') returning id into pipe_pat;
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Educação S19', 'education') returning id into pipe_edu;
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Parceiros S19', 'partners') returning id into pipe_par;
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Livre S19', 'custom') returning id into pipe_cus;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe_pat, 'Novo contato', 1, 'open') returning id into st_pat;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe_edu, 'Interesse', 1, 'open') returning id into st_edu;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe_par, 'Inscrição', 1, 'open') returning id into st_par;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe_cus, 'Novo', 1, 'open') returning id into st_cus;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Ana Paciente S19') returning id into p_ana;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Bia Aluna S19') returning id into p_bia;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Clara Parceira S19') returning id into p_cli;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ub, 'Dani Outra Unidade S19') returning id into p_dan;
  insert into public.person_contacts (org_id, person_id, type, value, normalized, is_primary) values (v_org, p_ana, 'phone', '(11) 98888-0001', '5511988880001', true);
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, created_by) values (v_org, ua, p_ana, pipe_pat, st_pat, u_s1, 'Fisioterapia — Ana', u_mgr) returning id into o_ana;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, created_by) values (v_org, ua, p_bia, pipe_edu, st_edu, u_s1, 'Mentoria — Bia', u_mgr) returning id into o_bia;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, created_by) values (v_org, ua, p_cli, pipe_par, st_par, u_s1, 'Parceria — Clara', u_mgr) returning id into o_cli;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, created_by) values (v_org, ua, p_ana, pipe_cus, st_cus, u_s1, 'Livre — Ana', u_mgr) returning id into o_cus;

  -- ============ 1) abrir conversa: responsável, idempotência, escopo
  set local role authenticated; perform pg_temp.as_user(u_s1);
  c_ana := public.crm_conversation_open(p_ana, o_ana);
  rep := rep || pg_temp.chk(c_ana is not null, 'comercial abre a conversa da pessoa/oportunidade');
  c_ana2 := public.crm_conversation_open(p_ana, o_ana);
  rep := rep || pg_temp.chk(c_ana2 = c_ana, 'abrir de novo devolve a MESMA conversa (uma por pessoa e canal)');
  select count(*) into n from public.crm_conversations where person_id = p_ana; rep := rep || pg_temp.chk(n = 1, 'existe uma única conversa para a pessoa');
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s1 and role = 'owner'; rep := rep || pg_temp.chk(n = 1, 'quem abriu é o responsável (owner)');
  select count(*) into n from public.crm_messages where conversation_id = c_ana and direction = 'system'; rep := rep || pg_temp.chk(n = 1, 'a abertura gera UMA mensagem de sistema (a segunda abertura não duplica)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_open(%L, null, ''sms'')', p_ana)) like '%canal inválido%', 'canal inválido é recusado');
  perform pg_temp.as_user(u_s3);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_open(%L, %L)', p_ana, o_ana)) like '42501%', 'comercial de OUTRA unidade não abre conversa de pessoa que não pode ler/editar');
  select count(*) into n from public.crm_conversations; select count(*) into n2 from public.crm_messages; rep := rep || pg_temp.chk(n = 0 and n2 = 0, 'comercial de outra unidade NÃO enxerga conversas nem mensagens (RLS)');
  rep := rep || pg_temp.chk(public.crm_conversations_inbox('all') = '[]'::jsonb, 'a caixa de entrada dele vem vazia');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_open(%L, %L)', p_ana, o_ana)) is not null, 'fisioterapeuta NÃO abre conversa do CRM');
  select count(*) into n from public.crm_conversations; rep := rep || pg_temp.chk(n = 0, 'fisioterapeuta NÃO lê conversas');
  perform pg_temp.as_user(u_pat);
  select count(*) into n from public.crm_conversations; select count(*) into n2 from public.crm_scheduled_messages; rep := rep || pg_temp.chk(n = 0 and n2 = 0, 'paciente NÃO lê conversas nem mensagens agendadas');

  -- ============ 2) multiatendimento: entrar, responder só participando
  perform pg_temp.as_user(u_s2);
  select count(*) into n from public.crm_conversations where id = c_ana; rep := rep || pg_temp.chk(n = 1, 'outro comercial da MESMA unidade enxerga a conversa (mesma regra das oportunidades)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_post(%L, ''outbound'', ''Olá'')', c_ana)) like '42501%', 'mas NÃO responde antes de entrar na conversa');
  perform public.crm_conversation_join(c_ana); perform public.crm_conversation_join(c_ana);
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana; rep := rep || pg_temp.chk(n = 2, 'entrar duas vezes não duplica o participante (2 atendentes)');
  select role into t from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s2; rep := rep || pg_temp.chk(t = 'collaborator', 'quem entra depois é colaborador (o responsável continua sendo o primeiro)');
  m1 := public.crm_conversation_post(c_ana, 'inbound', 'Oi, queria saber os horários');
  rep := rep || pg_temp.chk(m1 is not null, 'participante registra a mensagem recebida');

  -- ============ 3) não lidas
  perform pg_temp.as_user(u_s1);
  j := public.crm_conversations_inbox('mine');
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 1 and (j -> 0 ->> 'unread')::boolean and (j -> 0 ->> 'niche') = 'patients' and (j -> 0 ->> 'phone') = '5511988880001', 'responsável vê a conversa em "Minhas" com não lida, nicho "patients" e o telefone');
  rep := rep || pg_temp.chk(public.crm_conversations_unread() = 1, 'contador de não lidas = 1');
  perform public.crm_conversation_mark_read(c_ana);
  rep := rep || pg_temp.chk(public.crm_conversations_unread() = 0 and not ((public.crm_conversations_inbox('mine') -> 0 ->> 'unread')::boolean), 'ao abrir a conversa (mark_read) deixa de ser não lida');
  perform pg_temp.as_user(u_s2);
  rep := rep || pg_temp.chk(public.crm_conversations_unread() = 0, 'a leitura é POR USUÁRIO: quem registrou a mensagem já a leu (0), enquanto o responsável tinha 1');

  -- ============ 4) mensagens: enviada entra no histórico do lead; recebida e nota não
  perform pg_temp.as_user(u_s1);
  select count(*) into n from public.interactions where opportunity_id = o_ana; rep := rep || pg_temp.chk(n = 0, 'antes: nenhuma interação no histórico do lead');
  select first_response_at, last_contact_at into x from public.opportunities where id = o_ana; rep := rep || pg_temp.chk(x.first_response_at is null and x.last_contact_at is null, 'registrar a mensagem RECEBIDA não conta como primeira resposta nem como contato');
  m2 := public.crm_conversation_post(c_ana, 'outbound', 'Temos horário amanhã às 9h.', true);
  select delivery into t from public.crm_messages where id = m2; rep := rep || pg_temp.chk(t = 'whatsapp_opened', 'enviada com WhatsApp aberto fica como "whatsapp_opened" (sem confirmação de entrega)');
  select count(*) into n from public.interactions where opportunity_id = o_ana and channel = 'whatsapp' and summary like 'WhatsApp aberto%'; rep := rep || pg_temp.chk(n = 1, 'a mensagem enviada entra no histórico do lead como interação');
  select first_response_at, last_contact_at into x from public.opportunities where id = o_ana; rep := rep || pg_temp.chk(x.first_response_at is not null and x.last_contact_at is not null, 'a oportunidade ganhou primeira resposta e último contato');
  m3 := public.crm_conversation_post(c_ana, 'note', 'Prefere atendimento pela manhã.');
  select count(*) into n from public.interactions where opportunity_id = o_ana; rep := rep || pg_temp.chk(n = 1, 'nota interna NÃO vira interação (continua só 1)');
  select delivery into t from public.crm_messages where id = m3; rep := rep || pg_temp.chk(t = 'registered', 'nota fica "registered"');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_post(%L, ''system'', ''forjada'')', c_ana)) like '%tipo de mensagem inválido%', 'ninguém cria mensagem de sistema pela API');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_post(%L, ''note'', ''   '')', c_ana)) like '%escreva a mensagem%', 'mensagem vazia é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_post(%L, ''note'', %L)', c_ana, repeat('x', 4001))) like '%4000%', 'mensagem acima de 4000 caracteres é recusada');
  select last_message_direction, last_message_preview into x from public.crm_conversations where id = c_ana; rep := rep || pg_temp.chk(x.last_message_direction = 'note', 'a prévia da conversa acompanha a última mensagem');
  -- imutabilidade e escrita só por função
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.crm_messages set body = ''editada'' where id = %L', m2)) like '42501%', 'mensagem NÃO pode ser editada (sem privilégio de update)');
  rep := rep || pg_temp.chk(pg_temp.err(format('delete from public.crm_messages where id = %L', m2)) like '42501%', 'mensagem NÃO pode ser apagada');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_messages (org_id, unit_id, conversation_id, direction, body) values (%L, %L, %L, ''outbound'', ''direto'')', v_org, ua, c_ana)) like '42501%', 'mensagem NÃO é inserida direto na tabela');
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.crm_conversations set status = ''resolved'' where id = %L', c_ana)) like '42501%', 'estado da conversa só muda por função');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_conversation_participants (conversation_id, user_id) values (%L, %L)', c_ana, u_s3)) like '42501%', 'participante NÃO é inserido direto na tabela');

  -- ============ 5) adicionar, transferir e sair
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_add_participant(%L, %L)', c_ana, u_s3)) like '%não atende o CRM desta unidade%', 'não adiciona atendente de outra unidade');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_add_participant(%L, %L)', c_ana, u_phy)) like '%não atende o CRM%', 'não adiciona fisioterapeuta');
  perform pg_temp.as_user(u_s2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_transfer(%L, %L)', c_ana, u_s2)) like '42501%', 'colaborador NÃO transfere a conversa (só o responsável ou gestor)');
  perform pg_temp.as_user(u_s1);
  perform public.crm_conversation_transfer(c_ana, u_s2, true);
  select role into t from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s2; rep := rep || pg_temp.chk(t = 'owner', 'transferência: o novo responsável é o owner');
  select role into t from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s1; rep := rep || pg_temp.chk(t = 'collaborator', 'com "manter", o anterior continua como colaborador');
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana and role = 'owner'; rep := rep || pg_temp.chk(n = 1, 'sempre exatamente UM responsável');
  select owner_user_id into x from public.opportunities where id = o_ana; rep := rep || pg_temp.chk(x.owner_user_id = u_s2, 'a oportunidade acompanha o novo responsável');
  select count(*) into n from public.opportunity_events where opportunity_id = o_ana and kind = 'owner_changed'; rep := rep || pg_temp.chk(n = 1, 'a troca de responsável entra na trilha da oportunidade');
  select count(*) into n from public.crm_messages where conversation_id = c_ana and direction = 'system' and body like '%transferiu a conversa%'; rep := rep || pg_temp.chk(n = 1, 'a transferência fica registrada na conversa');
  perform pg_temp.as_user(u_mgr);
  perform public.crm_conversation_transfer(c_ana, u_s1, false);
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s2; rep := rep || pg_temp.chk(n = 0, 'gestor transfere sem manter: o anterior sai');
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana and role = 'owner' and user_id = u_s1; rep := rep || pg_temp.chk(n = 1, 'o comercial 1 volta a ser o responsável');
  perform pg_temp.as_user(u_s1);
  perform public.crm_conversation_leave(c_ana);
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana; rep := rep || pg_temp.chk(n = 0, 'o responsável sai e a conversa fica sem atendente');
  j := public.crm_conversations_inbox('queue'); rep := rep || pg_temp.chk(jsonb_array_length(j) = 1, 'conversa sem atendente aparece na FILA');
  rep := rep || pg_temp.chk(jsonb_array_length(public.crm_conversations_inbox('mine')) = 0, 'e deixa de aparecer em "Minhas"');
  perform pg_temp.as_user(u_s2);
  perform public.crm_conversation_join(c_ana);
  select role into t from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s2; rep := rep || pg_temp.chk(t = 'owner', 'quem assume a conversa da fila vira o responsável');
  perform public.crm_conversation_add_participant(c_ana, u_s1);
  select count(*) into n from public.crm_conversation_participants where conversation_id = c_ana; rep := rep || pg_temp.chk(n = 2, 'o responsável adiciona um colaborador (multiatendimento: 2 atendentes)');
  perform public.crm_conversation_leave(c_ana);
  select role into t from public.crm_conversation_participants where conversation_id = c_ana and user_id = u_s1; rep := rep || pg_temp.chk(t = 'owner', 'quando o responsável sai, o colaborador mais antigo assume');

  -- ============ 6) estado e busca
  perform pg_temp.as_user(u_s1);
  perform public.crm_conversation_set_status(c_ana, 'resolved');
  rep := rep || pg_temp.chk(jsonb_array_length(public.crm_conversations_inbox('all', 'resolved')) = 1 and jsonb_array_length(public.crm_conversations_inbox('all', 'open')) = 0, 'filtro por estado separa resolvidas de abertas');
  rep := rep || pg_temp.chk(jsonb_array_length(public.crm_conversations_inbox('all', null, 'ana pac')) = 1 and jsonb_array_length(public.crm_conversations_inbox('all', null, 'inexistente')) = 0, 'busca por nome');
  perform public.crm_conversation_post(c_ana, 'inbound', 'Voltei, ainda tem vaga?');
  select status into t from public.crm_conversations where id = c_ana; rep := rep || pg_temp.chk(t = 'open', 'nova mensagem reabre uma conversa resolvida');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_conversation_set_status(%L, ''arquivada'')', c_ana)) like '%estado inválido%', 'estado inválido é recusado');

  -- ============ 7) mensagens agendadas: lembrete + registro, nada enviado sozinho
  sch1 := public.crm_schedule_message(c_ana, 'Lembrete: sua avaliação é amanhã às 9h.', now() + interval '1 day');
  select task_id into task1 from public.crm_scheduled_messages where id = sch1;
  select count(*) into n from public.crm_tasks where id = task1 and kind = 'reminder' and assignee_user_id = u_s1 and done_at is null and opportunity_id = o_ana; rep := rep || pg_temp.chk(n = 1, 'agendar cria o LEMBRETE (tarefa do CRM) para o responsável pelo envio, ligada à oportunidade');
  select count(*) into n from public.crm_messages where conversation_id = c_ana and body like 'Lembrete: sua avaliação%'; rep := rep || pg_temp.chk(n = 0, 'agendar NÃO cria mensagem enviada: nada foi enviado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_schedule_message(%L, ''x'', now() - interval ''1 minute'')', c_ana)) like '%horário futuro%', 'horário no passado é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_schedule_message(%L, ''x'', now() + interval ''1 hour'', %L)', c_ana, u_s3)) like '%não atende o CRM desta unidade%', 'responsável pelo envio precisa atender o CRM da unidade');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_scheduled_messages (org_id, unit_id, conversation_id, person_id, body, scheduled_for) values (%L, %L, %L, %L, ''x'', now())', v_org, ua, c_ana, p_ana)) like '42501%', 'agendada só nasce por função');
  perform public.crm_scheduled_reschedule(sch1, now() + interval '2 days');
  select count(*) into n from public.crm_tasks where id = task1 and due_at > now() + interval '1 day 12 hours'; rep := rep || pg_temp.chk(n = 1, 'remarcar move o lembrete junto');
  sch2 := public.crm_schedule_message(c_ana, 'Segunda mensagem a cancelar', now() + interval '3 hours');
  perform public.crm_scheduled_cancel(sch2);
  select status into t from public.crm_scheduled_messages where id = sch2; rep := rep || pg_temp.chk(t = 'cancelled', 'cancelar marca a mensagem como cancelada');
  select count(*) into n from public.crm_tasks where dedupe_key = 'sched:' || sch2; rep := rep || pg_temp.chk(n = 0, 'e remove o lembrete pendente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_scheduled_cancel(%L)', sch2)) like '%já foi cancelada%', 'cancelar duas vezes é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_scheduled_reschedule(%L, now() + interval ''1 day'')', sch2)) like '%só mensagens agendadas%', 'não remarca mensagem cancelada');
  -- vencida: simula o horário passado direto na tabela como dono (fora do papel authenticated)
  reset role; update public.crm_scheduled_messages set scheduled_for = now() - interval '5 minutes' where id = sch1; set local role authenticated; perform pg_temp.as_user(u_s1);
  select count(*) into n from public.crm_scheduled_messages where status = 'scheduled' and scheduled_for <= now(); rep := rep || pg_temp.chk(n = 1, 'vencida = agendada com horário já passado ("pronta para enviar"); continua NÃO enviada');
  select count(*) into n from public.crm_messages where scheduled_message_id = sch1; rep := rep || pg_temp.chk(n = 0, 'nenhum envio automático ocorreu no horário');
  m4 := public.crm_scheduled_mark_sent(sch1);
  select status, sent_by, message_id into x from public.crm_scheduled_messages where id = sch1; rep := rep || pg_temp.chk(x.status = 'sent' and x.sent_by = u_s1 and x.message_id = m4, 'registrar o envio marca "sent" com autor e vincula a mensagem');
  select direction, delivery into x from public.crm_messages where id = m4; rep := rep || pg_temp.chk(x.direction = 'outbound' and x.delivery = 'whatsapp_opened', 'a mensagem registrada é "enviada · WhatsApp aberto" (sem prometer entrega)');
  select count(*) into n from public.crm_tasks where id = task1 and done_at is not null; rep := rep || pg_temp.chk(n = 1, 'o lembrete é concluído');
  select count(*) into n from public.interactions where opportunity_id = o_ana and summary like '%Lembrete: sua avaliação%'; rep := rep || pg_temp.chk(n = 1, 'o envio entra no histórico do lead');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_scheduled_mark_sent(%L)', sch1)) like '%já foi enviada%', 'registrar duas vezes NÃO duplica o envio');
  -- permissões na agendada
  sch3 := public.crm_schedule_message(c_ana, 'Terceira', now() + interval '1 day');
  perform pg_temp.as_user(u_s3);
  select count(*) into n from public.crm_scheduled_messages; rep := rep || pg_temp.chk(n = 0, 'comercial de outra unidade NÃO lê mensagens agendadas');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_scheduled_cancel(%L)', sch3)) like '42501%', 'nem cancela');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_scheduled_mark_sent(%L)', sch3)) like '42501%', 'fisioterapeuta NÃO registra envio');
  -- transferência leva a agendada pendente
  perform pg_temp.as_user(u_s1);
  perform public.crm_conversation_transfer(c_ana, u_s2, false);
  select count(*) into n from public.crm_scheduled_messages where id = sch3 and assignee_user_id = u_s2; select count(*) into n2 from public.crm_tasks where dedupe_key = 'sched:' || sch3 and assignee_user_id = u_s2;
  rep := rep || pg_temp.chk(n = 1 and n2 = 1, 'transferir a conversa leva a mensagem agendada pendente e o lembrete para o novo responsável');

  -- ============ 8) conversas de outros nichos + ficha por nicho
  perform pg_temp.as_user(u_s1);
  c_bia := public.crm_conversation_open(p_bia, o_bia);
  j := public.crm_conversations_inbox('all');
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 2, 'a caixa "Todas" mostra as duas conversas da unidade');
  select count(*) into n from jsonb_array_elements(j) e where e ->> 'niche' = 'education' and e ->> 'stage' = 'Interesse'; rep := rep || pg_temp.chk(n = 1, 'a conversa da aluna traz nicho "education" e a etapa atual');
  j := public.crm_lead_profile_save(o_ana, '{"contact_reason":"Dor lombar há 2 meses (administrativo)","preferred_period":"manha","payment_pref":"particular","referred_by":"  Dra. Paula  ","payment_pref_x":null}'::jsonb - 'payment_pref_x');
  rep := rep || pg_temp.chk(j ->> 'referred_by' = 'Dra. Paula' and j ->> 'preferred_period' = 'manha', 'paciente: ficha salva campos do nicho (texto limpo)');
  select profile into j from public.opportunities where id = o_ana; rep := rep || pg_temp.chk(j ->> 'payment_pref' = 'particular', 'o perfil fica gravado na oportunidade');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"course_interest":"Mentoria"}'')', o_ana)) like '%não pertence ao nicho%', 'campo de OUTRO nicho é recusado (paciente não tem "course_interest")');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"preferred_period":"madrugada"}'')', o_ana)) like '%valor inválido%', 'valor fora da lista é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"referred_by":%s}'')', o_ana, to_json(repeat('y', 201)))) like '%200 caracteres%', 'texto acima de 200 caracteres é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"referred_by":12}'')', o_ana)) like '%deve ser texto%', 'valor que não é texto é recusado');
  j := public.crm_lead_profile_save(o_bia, '{"course_interest":"Mentoria em dor crônica","professional_profile":"fisioterapeuta","format_pref":"online"}'::jsonb);
  rep := rep || pg_temp.chk(j ->> 'professional_profile' = 'fisioterapeuta' and not (j ? 'contact_reason'), 'educação: campos próprios do nicho');
  j := public.crm_lead_profile_save(o_cli, '{"partnership_type":"Clínica parceira","city_uf":"Campinas/SP"}'::jsonb);
  rep := rep || pg_temp.chk(j ->> 'city_uf' = 'Campinas/SP', 'parceiros: campos próprios do nicho');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"qualquer":"x"}'')', o_cus)) like '%não pertence ao nicho%', 'funil livre não aceita campos de nicho');
  j := public.crm_lead_profile_save(o_ana, '{"preferred_period":"tarde"}'::jsonb);
  rep := rep || pg_temp.chk(j ->> 'preferred_period' = 'tarde' and not (j ? 'referred_by'), 'salvar substitui o conjunto (campo não enviado é limpo)');
  perform pg_temp.as_user(u_s3);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"preferred_period":"noite"}'')', o_ana)) like '42501%', 'comercial de outra unidade NÃO altera a ficha');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_lead_profile_save(%L, ''{"preferred_period":"noite"}'')', o_ana)) is not null, 'fisioterapeuta NÃO altera a ficha');

  -- ============ 9) execução anônima e auditoria
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.crm_conversations_inbox()') is not null and pg_temp.err(format('select public.crm_conversation_open(%L)', p_ana)) is not null, 'anônimo não executa as funções');
  reset role;
  select count(*) into n from public.audit_log where entity_type = 'crm_conversations' and entity_id = c_ana::text; rep := rep || pg_temp.chk(n >= 2, 'conversa auditada (criação e mudança de estado)');
  select count(*) into n from public.audit_log where entity_type = 'crm_scheduled_messages' and entity_id = sch2::text; rep := rep || pg_temp.chk(n >= 2, 'mensagem agendada auditada (criação e cancelamento)');

  raise exception E'RELATORIO_S19_CONVERSAS (transação desfeita):%', rep;
end $$;
