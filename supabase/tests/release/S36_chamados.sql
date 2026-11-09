-- RELEASE v1 — S36: chamados internos (migration 099): elegibilidade pelo pagamento, privacidade clínica x administrativa, prazo (SLA), notas internas, reabertura, escopo do responsável.
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, p_act uuid default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.headers', case when p_act is null then '{}' else json_build_object('x-acting-as', p_act)::text end, true); end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; svc uuid; pr uuid; rep text := ''; j jsonb; n int; e text; t_adm uuid; t_cli uuid; t_kid uuid; t_old uuid; r jsonb;
  u_mgr uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_um uuid := gen_random_uuid(); u_umb uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_p3 uuid := gen_random_uuid(); u_p4 uuid := gen_random_uuid(); u_mae uuid := gen_random_uuid(); u_cg uuid := gen_random_uuid();
  pe_phy uuid; pe_phy2 uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p_mae uuid; p_kid uuid; p_cg uuid; prod_pkg uuid; prod_course uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A teste S36', 'teste-a-s36') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B teste S36', 'teste-b-s36') returning id into ub;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s36.local' from unnest(array[u_mgr,u_ops,u_um,u_umb,u_sales,u_phy,u_phy2,u_p1,u_p2,u_p3,u_p4,u_mae,u_cg]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S36 Um') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S36 Dois') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pago S36') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Sem pagamento S36') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Estornado S36') returning id into p3;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Só curso S36') returning id into p4;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Mãe S36') returning id into p_mae;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Criança S36', current_date - interval '8 years') returning id into p_kid;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Cuidadora S36') returning id into p_cg;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S36'),(u_ops, v_org, null, 'Adm S36'),(u_um, v_org, null, 'Gestor A S36'),(u_umb, v_org, null, 'Gestor B S36'),(u_sales, v_org, null, 'Comercial S36'),
    (u_phy, v_org, pe_phy, 'Fisio Um S36'),(u_phy2, v_org, pe_phy2, 'Fisio Dois S36'),(u_p1, v_org, p1, 'Pago'),(u_p2, v_org, p2, 'Sem pagamento'),(u_p3, v_org, p3, 'Estornado'),(u_p4, v_org, p4, 'Curso'),(u_mae, v_org, p_mae, 'Mãe'),(u_cg, v_org, p_cg, 'Cuidadora');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_mgr,'manager',null),(v_org,u_ops,'ops_admin',null),(v_org,u_um,'unit_manager',ua),(v_org,u_umb,'unit_manager',ub),(v_org,u_sales,'sales',ua),
    (v_org,u_phy,'physio',ua),(v_org,u_phy2,'physio',ua),(v_org,u_p1,'member',null),(v_org,u_p2,'member',null),(v_org,u_p3,'member',null),(v_org,u_p4,'member',null),(v_org,u_mae,'member',null),(v_org,u_cg,'member',null);
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio S36 Um') returning id into pr;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy2, pe_phy2, 'Fisio S36 Dois');
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p1);
  -- vínculos do responsável: a mãe (todos os escopos) e a cuidadora (sem o escopo de chamados)
  insert into public.care_representations (org_id, unit_id, patient_person_id, representative_person_id, kind, can_agenda, can_cancel, can_train, can_evolution, can_billing, can_consent, can_ticket, status, verified_at)
    values (v_org, ua, p_kid, p_mae, 'responsavel_legal', true, true, true, true, true, true, true, 'verified', now());
  insert into public.care_representations (org_id, unit_id, patient_person_id, representative_person_id, kind, can_agenda, status, verified_at, patient_accepted_at, valid_until)
    values (v_org, ua, p_kid, p_cg, 'cuidador', true, 'verified', now(), now(), current_date + 30);
  -- pagamentos: pacote pago (p1 e a criança), pacote estornado por inteiro (p3), curso pago (p4)
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S36', 30) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, validity_days, service_id) values (v_org, 'package', 'Pacote S36', 80000, 8, 90, svc) returning id into prod_pkg;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'course', 'Curso S36', 50000) returning id into prod_course;
  for e in select unnest(array['p1','kid','p3','p4']) loop
    declare v_p uuid := case e when 'p1' then p1 when 'kid' then p_kid when 'p3' then p3 else p4 end; v_prod uuid := case e when 'p4' then prod_course else prod_pkg end; v_s uuid; v_r uuid; v_pay uuid;
    begin
      insert into public.sales (org_id, unit_id, person_id, status, subtotal_cents, total_cents, sold_at) values (v_org, ua, v_p, 'confirmed', 80000, 80000, now()) returning id into v_s;
      insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
        values (v_org, ua, v_s, v_p, v_prod, 1, 1, current_date, date_trunc('month', current_date)::date, 80000, 'paid') returning id into v_r;
      insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key) values (v_org, ua, v_r, 'payment', 80000, 'pay-' || e || gen_random_uuid()::text) returning id into v_pay;
      if e = 'p3' then insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key, refund_of) values (v_org, ua, v_r, 'refund', 80000, 'ref-' || gen_random_uuid()::text, v_pay); end if;
    end;
  end loop;

  set local role authenticated;
  -- ============ regras de prazo (SLA) — função pura
  reset role;
  rep := rep || pg_temp.chk(private.sla_due(timestamptz '2026-11-06 15:00:00-03', false) = timestamptz '2026-11-09 15:00:00-03', 'administrativo aberto na sexta 15h: prazo vai para segunda 15h (sábado/domingo não contam)');
  rep := rep || pg_temp.chk(private.sla_due(timestamptz '2026-11-06 15:00:00-03', true) = timestamptz '2026-11-07 15:00:00-03', 'clínico aberto na sexta 15h: 24 h corridas (sábado 15h)');
  rep := rep || pg_temp.chk(private.sla_due(timestamptz '2026-11-09 10:00:00-03', false) = timestamptz '2026-11-10 10:00:00-03', 'administrativo aberto na segunda 10h: terça 10h');
  set local role authenticated;

  -- ============ elegibilidade
  perform pg_temp.as_user(u_p2);
  rep := rep || pg_temp.chk(not public.my_ticket_eligibility(), 'sem pagamento: não pode abrir chamado');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_ticket_open(''agenda'', ''Remarcar'', ''Preciso remarcar'')') like '%pagamento confirmado%', 'abrir sem pagamento é recusado com orientação');
  perform pg_temp.as_user(u_p3); rep := rep || pg_temp.chk(not public.my_ticket_eligibility(), 'pagamento totalmente estornado: não pode abrir');
  perform pg_temp.as_user(u_p4); rep := rep || pg_temp.chk(not public.my_ticket_eligibility(), 'só curso pago (não é sessão/pacote/plano): não pode abrir');
  perform pg_temp.as_user(u_p1); rep := rep || pg_temp.chk(public.my_ticket_eligibility(), 'pacote pago: pode abrir');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_ticket_open(''inexistente'', ''Assunto'', ''Mensagem'')') like '%categoria inválida%', 'categoria inválida é recusada');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_ticket_open(''agenda'', ''ab'', ''x'')') like '%descreva%', 'assunto e mensagem curtos demais são recusados');

  -- ============ abertura: administrativa e clínica
  t_adm := public.my_ticket_open('agenda', 'Remarcar sessão de quinta', 'Preciso remarcar para sexta', 'k-adm');
  rep := rep || pg_temp.chk(public.my_ticket_open('agenda', 'Remarcar sessão de quinta', 'Preciso remarcar para sexta', 'k-adm') = t_adm, 'repetir o envio com a mesma chave devolve o mesmo chamado');
  t_cli := public.my_ticket_open('clinica', 'Dor ao fazer o exercício 2', 'Senti dor forte no joelho ontem');
  reset role; select count(*) into n from public.crm_tasks where dedupe_key = 'ticket:' || t_adm; rep := rep || pg_temp.chk(n = 1, 'chamado ADMINISTRATIVO cria tarefa para o responsável do CRM');
  select count(*) into n from public.crm_tasks where dedupe_key = 'ticket:' || t_cli; rep := rep || pg_temp.chk(n = 0, 'chamado CLÍNICO não vai para o CRM (privacidade)');
  set local role authenticated;
  for n in 1..3 loop perform public.my_ticket_open('outro', 'Dúvida ' || n, 'Mensagem ' || n); end loop;
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_ticket_open(''outro'', ''Dúvida 9'', ''Mensagem 9'')') like '%muitos chamados abertos%', 'mais de 5 chamados em aberto é recusado');

  -- ============ fila e privacidade
  perform pg_temp.as_user(u_ops); j := public.support_queue();
  r := (select x from jsonb_array_elements(j) x where x ->> 'id' = t_cli::text);
  rep := rep || pg_temp.chk((r ->> 'masked')::boolean and r ->> 'subject' like 'Chamado clínico%' and position('joelho' in r::text) = 0, 'adm. operacional vê que o chamado clínico existe, SEM assunto nem conteúdo');
  rep := rep || pg_temp.chk(jsonb_array_length(public.support_ticket(t_cli) -> 'messages') = 0, 'e não lê as mensagens do chamado clínico');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.support_reply(%L, ''olá'')', t_cli)) like '42501%', 'nem responde ao chamado clínico (42501)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.support_reclassify(%L, ''agenda'')', t_cli)) like '42501%', 'nem reclassifica o clínico (só quem lê)');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j) x where x ->> 'id' = t_adm::text and not (x ->> 'masked')::boolean and x ->> 'subject' = 'Remarcar sessão de quinta'), 'o administrativo aparece completo para a equipe');
  perform pg_temp.as_user(u_umb); j := public.support_queue();
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(j) x where x ->> 'id' in (t_adm::text, t_cli::text)), 'gestor de OUTRA unidade não vê os chamados desta unidade');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.support_queue()') like '42501%', 'comercial não acessa a fila de chamados');
  perform pg_temp.as_user(u_phy2); j := public.support_queue();
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 0, 'fisio SEM vínculo não vê nenhum chamado do paciente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.support_ticket(%L)', t_cli)) like '42501%', 'e não abre o clínico (42501)');
  perform pg_temp.as_user(u_phy); j := public.support_queue();
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j) x where x ->> 'id' = t_cli::text and not (x ->> 'masked')::boolean) and not exists (select 1 from jsonb_array_elements(j) x where x ->> 'id' = t_adm::text), 'fisio vinculado vê o clínico (completo) e não os administrativos');
  rep := rep || pg_temp.chk(position('joelho' in public.support_ticket(t_cli)::text) > 0, 'e lê o conteúdo do chamado clínico');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(public.prof_home() -> 'alerts') a where a ->> 'kind' = 'chamado'), 'o Início do fisio avisa do chamado clínico sem resposta');
  perform public.support_reply(t_cli, 'Anotei. Evite o exercício 2 até a próxima sessão.', false, 'r1');
  perform public.support_reply(t_cli, 'nota interna do fisio', true);
  rep := rep || pg_temp.chk((public.support_ticket(t_cli) ->> 'status') = 'waiting_patient' and (public.support_ticket(t_cli) ->> 'first_response_at') is not null and (public.support_ticket(t_cli) ->> 'sla') = 'met', '1ª resposta marca o prazo como cumprido e aguarda o paciente');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(public.prof_home() -> 'alerts') a where a ->> 'kind' = 'chamado'), 'respondido: sai do alerta');
  reset role; select count(*) into n from public.clinical_access_log where person_id = p1 and scope = 'ticket' and accessed_by_role = 'professional'; rep := rep || pg_temp.chk(n = 1, 'a leitura do chamado clínico pelo fisio fica registrada'); set local role authenticated;
  perform pg_temp.as_user(u_mgr); perform public.support_ticket(t_cli);
  reset role; select count(*) into n from public.clinical_access_log where person_id = p1 and scope = 'ticket' and accessed_by_role = 'admin'; rep := rep || pg_temp.chk(n = 1, 'a leitura do gestor também'); set local role authenticated;

  -- ============ o paciente vê o que é dele (sem nota interna)
  perform pg_temp.as_user(u_p1); j := public.my_ticket(t_cli);
  rep := rep || pg_temp.chk(position('Evite o exercício 2' in j::text) > 0 and position('nota interna' in j::text) = 0, 'o paciente lê a resposta e NÃO a nota interna');
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_tickets()) = 5, 'lista os próprios chamados');
  perform pg_temp.as_user(u_p2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_ticket(%L)', t_cli)) like '42501%' and pg_temp.err(format('select public.my_ticket_reply(%L, ''oi'')', t_cli)) like '42501%', 'outro paciente não lê nem responde chamado alheio');
  perform pg_temp.as_user(u_p1); perform public.my_ticket_reply(t_cli, 'Obrigado, vou evitar.');
  rep := rep || pg_temp.chk((public.my_ticket(t_cli) ->> 'status') = 'in_progress', 'a resposta do paciente reabre o atendimento (em andamento)');

  -- ============ equipe administrativa: responde, encerra, reabre, prazo de 7 dias
  perform pg_temp.as_user(u_um); perform public.support_reply(t_adm, 'Remarcado para sexta às 10h.'); perform public.support_set_status(t_adm, 'resolved');
  perform pg_temp.as_user(u_p1); perform public.my_ticket_reply(t_adm, 'Perfeito, obrigado');
  rep := rep || pg_temp.chk((public.my_ticket(t_adm) ->> 'status') = 'in_progress', 'paciente responde em até 7 dias: o chamado reabre');
  perform pg_temp.as_user(u_um); perform public.support_set_status(t_adm, 'resolved');
  reset role; update public.support_tickets set resolved_at = now() - interval '8 days' where id = t_adm; set local role authenticated;
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_ticket_reply(%L, ''de novo'')', t_adm)) like '%mais de 7 dias%', 'encerrado há mais de 7 dias: abrir um novo chamado');
  perform pg_temp.as_user(u_phy); perform public.support_reclassify(t_cli, 'agenda');
  perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(position('joelho' in public.support_ticket(t_cli)::text) > 0, 'reclassificado para administrativo, a equipe passa a ler');

  -- ============ escalada e indicadores
  reset role; update public.support_tickets set category = 'clinica', first_response_at = null, status = 'open', created_at = now() - interval '13 hours' where id = t_cli; set local role authenticated;
  perform pg_temp.as_user(u_mgr); j := public.support_queue();
  rep := rep || pg_temp.chk((select (x ->> 'escalated')::boolean from jsonb_array_elements(j) x where x ->> 'id' = t_cli::text), 'clínico sem resposta há mais de 12 h aparece como ESCALADO ao gestor');
  r := public.support_kpis();
  rep := rep || pg_temp.chk((r ->> 'total')::int >= 5 and r ? 'by_category' and r ? 'avg_first_response_h', 'indicadores: volume, categorias e tempo de 1ª resposta');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err('select public.support_kpis()') like '42501%', 'comercial não vê os indicadores');

  -- ============ responsável legal abre chamado pela criança; cuidadora sem o escopo não
  perform pg_temp.as_user(u_mae, p_kid);
  t_kid := public.my_ticket_open('pagamento', 'Dúvida sobre a cobrança da criança', 'Gostaria de entender o valor');
  reset role; select count(*) into n from public.support_tickets where id = t_kid and person_id = p_kid and in_name_of; set local role authenticated; rep := rep || pg_temp.chk(n = 1, 'a mãe abre o chamado EM NOME da criança (registrado como tal)');
  perform pg_temp.as_user(u_cg, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_ticket_open(''outro'', ''Assunto'', ''Mensagem'')') like '42501%', 'cuidadora sem escopo de chamados: 42501');
  -- ============ sem acesso direto às tabelas; anônimo
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.support_tickets') like '42501%' and pg_temp.err('select count(*) from public.support_messages') like '42501%', 'ninguém lê as tabelas direto');
  set local role anon;
  foreach e in array array['my_tickets()','my_ticket_eligibility()','support_queue()'] loop rep := rep || pg_temp.chk(pg_temp.err('select public.' || e) like '42501%', format('anônimo não executa %s', e)); end loop;
  raise exception 'RELATORIO_S36%', rep;
end $$;
