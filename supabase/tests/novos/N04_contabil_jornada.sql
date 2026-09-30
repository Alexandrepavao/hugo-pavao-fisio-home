-- NOVO (etapa ADM+Contábil, 2026-09-29) — jornada do Contábil no banco (migrations 049-050).
-- Cobre: livro reaproveitando o Financeiro sem duplicar; caixa ≠ competência; classificação (manual, sugestão por categoria,
-- dispensa com justificativa); comprovantes; revisão → fechamento com bloqueios; competência fechada imutável; alterações
-- posteriores do Financeiro sinalizadas (valor, inclusão, cancelamento) e que NÃO sinalizam (status de recebimento);
-- aceitar alteração; reabertura com permissão + justificativa + auditoria; refechamento com novo snapshot; exportação. Transação desfeita.
create or replace function pg_temp.res(p_ok boolean, p_msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when p_ok then 'OK' else 'FALHA' end, p_msg) $$;
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_acc uuid := gen_random_uuid();
  rep text := ''; ok boolean; n int; x jsonb; y jsonb; v_person uuid; v_sale uuid; v_rec uuid; v_pay uuid; v_py1 uuid; v_py2 uuid; v_py3 uuid; v_cat uuid;
  a_rev uuid; a_exp uuid; a_alug uuid; v_path text; v_path2 uuid; msg text; before_tot int; mkt_before bigint;
  v_rows_before int; m1 date; m2 date; tz text := 'America/Sao_Paulo';
begin
  -- meses ancorados em "hoje − 12 meses" (dentro das janelas de 12/13 meses do app e fora dos meses usados pelos E2E)
  m1 := (date_trunc('month', now() at time zone tz) - interval '12 months')::date; m2 := (m1 + interval '1 month')::date;
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','n04m@t.local'),(u_fin,'authenticated','authenticated','n04f@t.local'),(u_acc,'authenticated','authenticated','n04a@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr,v_org),(u_fin,v_org),(u_acc,v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_mgr,'manager',null),(v_org,u_fin,'finance',v_ua),(v_org,u_acc,'accountant',v_ua);
  select id into v_person from public.people where org_id = v_org and full_name is not null limit 1;

  -- ---- dados do Financeiro (maio/2026, mês já encerrado) — inseridos direto nas tabelas do Financeiro, como o app faria
  select count(*) into before_tot from public.receivables where unit_id = v_ua and competence_month = m1;
  insert into public.sales (org_id, unit_id, person_id) values (v_org, v_ua, v_person) returning id into v_sale;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, v_ua, v_sale, v_person, 1, 1, (m1 + 7), m1, 30000, 'paid') returning id into v_rec;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key)
    values (v_org, v_ua, v_rec, 'payment', 30000, ((m1 + 9)::timestamp + interval '15 hours') at time zone tz, 'n04-pay-1') returning id into v_pay;
  insert into public.finance_categories (org_id, name, kind) values (v_org, 'QA N04 Aluguel', 'expense') returning id into v_cat;
  insert into public.payables (org_id, unit_id, category_id, description, supplier, amount_cents, due_date, competence_month, status, paid_at)
    values (v_org, v_ua, v_cat, 'N04 Aluguel maio', 'Imobiliária X', 10000, (m1 + 4), m1, 'paid', ((m1 + 5)::timestamp + interval '12 hours') at time zone tz) returning id into v_py1;
  insert into public.payables (org_id, unit_id, description, supplier, amount_cents, due_date, competence_month, status, paid_at)
    values (v_org, v_ua, 'N04 Insumos maio (pago em junho)', 'Fornecedor Y', 5000, (m1 + 27), m1, 'paid', ((m2 + 2)::timestamp + interval '12 hours') at time zone tz) returning id into v_py2;

  -- ---- gestão prepara: classificações, mapeamento, concessões
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true); set local role authenticated;
  a_rev := (public.acc_account_upsert(null, 'N04R', 'Receita N04', 'income')->>'id')::uuid;
  a_alug := (public.acc_account_upsert(null, 'N04D1', 'Aluguel N04', 'expense')->>'id')::uuid;
  a_exp := (public.acc_account_upsert(null, 'N04D2', 'Insumos N04', 'expense')->>'id')::uuid;
  ok := false; begin perform public.acc_account_upsert(null, 'N04R', 'Duplicada', 'income'); exception when others then ok := sqlerrm ilike '%mesmo código%' or sqlerrm ilike '%este código%'; end;
  rep := rep || pg_temp.res(ok, 'código de classificação duplicado é recusado');
  perform public.acc_category_map_set(v_cat, a_alug);
  perform public.acc_grant_set(u_fin, 'close', v_ua, true);
  perform public.acc_grant_set(u_fin, 'reopen', v_ua, true);
  reset role;

  -- ---- livro: sem duplicar transações, caixa ≠ competência
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  x := public.acc_ledger_list(v_ua, m1, 'competencia');
  rep := rep || pg_temp.res((x->>'total')::int = 3 and (x->'summary'->>'income_cents')::bigint = 30000 and (x->'summary'->>'expense_cents')::bigint = 15000,
    'competência de maio: 1 recebível + 2 contas a pagar (R$ 300 receita, R$ 150 despesa), inclusive a paga em junho');
  y := public.acc_ledger_list(v_ua, m1, 'caixa');
  rep := rep || pg_temp.res((y->>'total')::int = 2 and (y->'summary'->>'income_cents')::bigint = 30000 and (y->'summary'->>'expense_cents')::bigint = 10000,
    'caixa de maio: 1 recebimento + 1 pagamento (R$ 100); a conta paga em junho NÃO entra no caixa de maio');
  y := public.acc_ledger_list(v_ua, m2, 'caixa');
  rep := rep || pg_temp.res((y->>'total')::int = 1 and (y->'summary'->>'expense_cents')::bigint = 5000 and (public.acc_ledger_list(v_ua, m2, 'competencia')->>'total')::int = 0,
    'a conta de maio paga em junho aparece no caixa de junho e não na competência de junho');
  reset role;
  select count(*) into n from public.receivables where unit_id = v_ua and competence_month = m1;
  rep := rep || pg_temp.res(n = before_tot + 1, 'nenhuma transação foi copiada: o Financeiro segue com a mesma quantidade de recebíveis');
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name like 'acc\_%' and column_name in ('amount_cents') and table_name not in ('acc_period_snapshot');
  rep := rep || pg_temp.res(n = 0, 'nenhuma tabela contábil guarda valor de transação (só o snapshot de fechamento guarda a impressão digital)');

  -- ---- pendências e bloqueios antes de fechar
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  x := public.acc_dashboard(v_ua, m1);
  rep := rep || pg_temp.res((x->'metrics'->>'unclassified')::int = 3 and (x->'metrics'->>'missing_receipt')::int = 2 and x->'period'->>'status' = 'open',
    'indicadores: 3 sem classificação, 2 despesas pagas sem comprovante, competência aberta');
  rep := rep || pg_temp.res(x->'overdue_months' @> to_jsonb(m1::text), 'maio aparece como competência encerrada ainda não fechada');
  ok := false; begin perform public.acc_period_close(v_ua, m1); exception when others then ok := sqlerrm ilike '%Em revisão%'; end;
  rep := rep || pg_temp.res(ok, 'não fecha sem passar por revisão');
  perform public.acc_period_request_review(v_ua, m1);
  ok := false; begin perform public.acc_period_close(v_ua, m1); exception when others then msg := sqlerrm; ok := msg ilike '%sem classificação%'; end;
  rep := rep || pg_temp.res(ok, 'em revisão, fechar é bloqueado enquanto há lançamentos sem classificação');
  y := public.acc_pendencies(v_ua, m1, 'unclassified');
  rep := rep || pg_temp.res(jsonb_array_length(y->'rows') = 3, 'pendências de classificação listam os 3 lançamentos');

  -- ---- classificar
  x := public.acc_apply_suggestions(v_ua, m1);
  rep := rep || pg_temp.res((x->>'applied')::int = 1, 'sugestão por categoria classifica só a conta com categoria mapeada (aluguel)');
  x := public.acc_classify(v_ua, jsonb_build_array(jsonb_build_object('source_type','receivable','source_id',v_rec)), a_rev, 'receita do mês');
  x := public.acc_classify(v_ua, jsonb_build_array(jsonb_build_object('source_type','payable','source_id',v_py2)), a_exp, null);
  ok := false; begin perform public.acc_classify(v_ua, jsonb_build_array(jsonb_build_object('source_type','payment','source_id',v_pay)), a_rev, null); exception when others then ok := true; end;
  rep := rep || pg_temp.res(ok, 'pagamento não é classificado diretamente (herda do recebível)');
  y := public.acc_ledger_list(v_ua, m1, 'caixa');
  rep := rep || pg_temp.res(exists (select 1 from jsonb_array_elements(y->'rows') r where r->>'source_type' = 'payment' and r->>'account_name' = 'Receita N04'), 'recebimento em caixa herda a classificação do recebível');
  ok := false; begin perform public.acc_classify(v_ua, jsonb_build_array(jsonb_build_object('source_type','receivable','source_id',gen_random_uuid())), a_rev, null); exception when others then ok := sqlerrm ilike '%não pertence%'; end;
  rep := rep || pg_temp.res(ok, 'não classifica lançamento inexistente/de outra unidade');
  x := public.acc_dashboard(v_ua, m1);
  rep := rep || pg_temp.res((x->'metrics'->>'unclassified')::int = 0, 'após classificar: 0 sem classificação');

  -- ---- comprovante e dispensa
  ok := false; begin perform public.acc_period_close(v_ua, m1); exception when others then ok := sqlerrm ilike '%sem comprovante%'; end;
  rep := rep || pg_temp.res(ok, 'fechar é bloqueado enquanto há despesa paga sem comprovante');
  reset role;
  v_path := v_org || '/' || v_ua || '/2019-05/' || gen_random_uuid() || '-recibo.pdf';
  insert into storage.objects (bucket_id, name) values ('accounting-private', v_path);
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_document_register(v_ua, m1, 'payable', v_py1, 'comprovante', 'Recibo', v_org || '/' || v_ua || '/2019-05/inexistente.pdf', 'application/pdf', 10); exception when others then ok := sqlerrm ilike '%não encontrado%'; end;
  rep := rep || pg_temp.res(ok, 'não registra documento cujo arquivo não existe no armazenamento');
  perform public.acc_document_register(v_ua, m1, 'payable', v_py1, 'comprovante', 'Recibo do aluguel', v_path, 'application/pdf', 2048);
  ok := false; begin perform public.acc_waive(v_ua, 'payable', v_py2, 'receipt', 'x'); exception when others then ok := sqlerrm ilike '%justificativa%'; end;
  rep := rep || pg_temp.res(ok, 'dispensa exige justificativa');
  perform public.acc_waive(v_ua, 'payable', v_py2, 'receipt', 'Pagamento em dinheiro sem recibo emitido pelo fornecedor');
  x := public.acc_dashboard(v_ua, m1);
  rep := rep || pg_temp.res((x->'metrics'->>'missing_receipt')::int = 0 and (x->'metrics'->>'documents')::int = 1, 'comprovante anexado + dispensa justificada: 0 sem comprovante, 1 documento');
  y := public.acc_document_list(v_ua, m1);
  rep := rep || pg_temp.res(jsonb_array_length(y) = 1 and y->0->>'source_label' = 'N04 Aluguel maio', 'lista de documentos mostra o lançamento ao qual o comprovante está vinculado');

  -- ---- revisão e fechamento
  x := public.acc_period_detail(v_ua, m1);
  rep := rep || pg_temp.res((x->>'ready_to_close')::boolean and x->>'status' = 'in_review', 'todos os bloqueios liberados: pronta para fechar');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_period_close(v_ua, m1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador sem concessão não fecha, mesmo com tudo pronto');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_period_close(v_ua, date_trunc('month', now())::date); exception when others then ok := sqlerrm ilike '%em andamento%'; end;
  rep := rep || pg_temp.res(ok, 'não fecha mês em andamento (mês corrente)');
  x := public.acc_period_close(v_ua, m1, 'Fechamento de maio conferido');
  rep := rep || pg_temp.res(x->>'status' = 'closed' and (x->>'close_seq')::int = 1, 'fecha a competência (versão 1)');
  select count(*) into n from public.acc_period_snapshot s join public.acc_periods p on p.id = s.period_id where p.unit_id = v_ua and p.competence_month = m1 and s.close_seq = 1;
  rep := rep || pg_temp.res(n = 5, 'snapshot guarda 5 impressões digitais (3 competência + 2 caixa)');
  x := public.acc_period_detail(v_ua, m1);
  rep := rep || pg_temp.res((x->'totals_at_close'->>'entries_comp')::int = 3 and jsonb_array_length(x->'changes') = 0, 'totais do fechamento gravados e nenhuma alteração pendente');

  -- ---- competência fechada é imutável para o app
  ok := false; begin perform public.acc_classify(v_ua, jsonb_build_array(jsonb_build_object('source_type','receivable','source_id',v_rec)), a_exp, null); exception when others then ok := sqlerrm ilike '%fechada%'; end;
  rep := rep || pg_temp.res(ok, 'reclassificar em competência fechada é recusado');
  ok := false; begin perform public.acc_waive(v_ua, 'payable', v_py1, 'receipt', 'tentativa após fechamento'); exception when others then ok := sqlerrm ilike '%fechada%'; end;
  rep := rep || pg_temp.res(ok, 'dispensar em competência fechada é recusado');
  ok := false; begin perform public.acc_document_remove((public.acc_document_list(v_ua, m1)->0->>'id')::uuid, 'remoção após o fechamento'); exception when others then ok := sqlerrm ilike '%fechada%'; end;
  rep := rep || pg_temp.res(ok, 'remover comprovante em competência fechada é recusado');
  ok := false; begin perform public.acc_period_request_review(v_ua, m1); exception when others then ok := true; end;
  rep := rep || pg_temp.res(ok, 'não reabre revisão de competência fechada sem reabrir');
  reset role;

  -- ---- Financeiro muda depois do fechamento (sem bloqueio: só sinaliza)
  update public.receivables set status = 'open' where id = v_rec;          -- status de recebimento NÃO altera a competência
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  rep := rep || pg_temp.res(jsonb_array_length(public.acc_period_detail(v_ua, m1)->'changes') = 0, 'mudar só o status de recebimento não sinaliza (competência e valor intactos)');
  reset role;
  update public.payables set amount_cents = 12000 where id = v_py1;        -- valor mudou: competência + caixa
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, v_ua, v_rec, 'refund', 5000, ((m1 + 19)::timestamp + interval '10 hours') at time zone tz, 'n04-refund-1');   -- estorno novo em maio
  update public.payables set status = 'cancelled' where id = v_py2;        -- cancelada: some da competência
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  x := public.acc_period_detail(v_ua, m1);
  rep := rep || pg_temp.res(jsonb_array_length(x->'changes') = 4, 'alterações posteriores sinalizadas: valor da conta (competência+caixa), estorno novo, conta cancelada = 4 (vê ' || jsonb_array_length(x->'changes') || ')');
  rep := rep || pg_temp.res(exists (select 1 from jsonb_array_elements(x->'changes') c where c->>'change_type' = 'added' and c->>'basis' = 'caixa')
      and exists (select 1 from jsonb_array_elements(x->'changes') c where c->>'change_type' = 'removed' and c->>'basis' = 'competencia')
      and exists (select 1 from jsonb_array_elements(x->'changes') c where c->>'change_type' = 'changed' and (c->>'snapshot_cents')::bigint = -10000 and (c->>'current_cents')::bigint = -12000), 'tipos: incluído, removido e alterado (de −R$ 100 para −R$ 120)');
  y := public.acc_pendencies(v_ua, m1, 'changed_after_close');
  rep := rep || pg_temp.res(jsonb_array_length(y->'rows') = 4, 'pendências mostram as 4 alterações para revisão');
  rep := rep || pg_temp.res((public.acc_dashboard(v_ua, m1)->'metrics'->>'changes_after_close')::int = 4, 'indicador do dashboard: 4 alterações após o fechamento');
  rep := rep || pg_temp.res((select count(*) from jsonb_array_elements(public.acc_periods_overview(v_ua)) o where o->>'month' = m1::text and (o->'metrics'->>'changes_after_close')::int = 4) = 1, 'visão de competências também sinaliza maio');
  y := public.acc_ledger_list(v_ua, m1, 'caixa', null, 'changed');
  rep := rep || pg_temp.res((y->>'total')::int = 2, 'filtro "alterados" nos lançamentos de caixa mostra as linhas modificadas/incluídas');

  -- aceitar uma alteração
  ok := false; begin perform public.acc_change_accept(v_ua, m1, 'payable', v_py2, 'competencia', 'ok'); exception when others then ok := sqlerrm ilike '%justificativa%'; end;
  rep := rep || pg_temp.res(ok, 'aceitar alteração exige justificativa');
  perform public.acc_change_accept(v_ua, m1, 'payable', v_py2, 'competencia', 'Conta cancelada por erro de lançamento, conferido com o contador');
  rep := rep || pg_temp.res(jsonb_array_length(public.acc_period_detail(v_ua, m1)->'changes') = 3, 'alteração aceita deixa de ser sinalizada (3 restantes)');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_change_accept(v_ua, m1, 'payable', v_py1, 'competencia', 'tentando aceitar sem permissão'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador sem concessão não aceita alteração');
  reset role;

  -- ---- reabertura
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_period_reopen(v_ua, m1, 'contador tentando reabrir sem concessão'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador sem concessão de reabrir não reabre');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_period_reopen(v_ua, m1, 'curto'); exception when others then ok := sqlerrm ilike '%Justifique%'; end;
  rep := rep || pg_temp.res(ok, 'reabertura exige justificativa com tamanho mínimo');
  x := public.acc_period_reopen(v_ua, m1, 'Reabrindo para tratar alterações do Financeiro posteriores ao fechamento');
  rep := rep || pg_temp.res(x->>'status' = 'open' and (x->>'pending_changes')::int = 3, 'reabre a competência informando as 3 alterações pendentes');
  reset role;
  select count(*) into n from public.audit_log where action = 'acc_period_reopen' and actor_user_id = u_fin and new_values->>'reason' like 'Reabrindo para tratar%';
  rep := rep || pg_temp.res(n = 1, 'reabertura auditada com justificativa e ator');
  select count(*) into n from public.audit_log where action = 'acc_period_close' and actor_user_id = u_fin and (new_values->>'close_seq')::int = 1;
  rep := rep || pg_temp.res(n = 1, 'fechamento auditado com ator e totais');
  select count(*) into n from public.acc_period_events e join public.acc_periods p on p.id = e.period_id where p.unit_id = v_ua and p.competence_month = m1 and e.action in ('review_requested','closed','change_accepted','reopened');
  rep := rep || pg_temp.res(n = 4, 'histórico do período registra revisão, fechamento, aceitação e reabertura');

  -- ---- reclassificar depois de reabrir, refechar, snapshot novo
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  perform public.acc_classify(v_ua, jsonb_build_array(jsonb_build_object('source_type','payable','source_id',v_py1)), a_exp, 'reclassificado após reabertura');
  rep := rep || pg_temp.res(jsonb_array_length(public.acc_period_detail(v_ua, m1)->'changes') = 0, 'com a competência aberta, deixa de haver “alteração após fechamento”');
  ok := false; begin perform public.acc_period_close(v_ua, m1); exception when others then ok := sqlerrm ilike '%Em revisão%'; end;
  rep := rep || pg_temp.res(ok, 'refechar exige nova revisão');
  perform public.acc_period_request_review(v_ua, m1);
  x := public.acc_period_close(v_ua, m1, 'Refechamento após ajustes');
  rep := rep || pg_temp.res((x->>'close_seq')::int = 2, 'refecha (versão 2)');
  rep := rep || pg_temp.res(jsonb_array_length(public.acc_period_detail(v_ua, m1)->'changes') = 0, 'novo snapshot vira a base: nenhuma alteração pendente');
  select count(*) into n from public.acc_period_snapshot s join public.acc_periods p on p.id = s.period_id where p.unit_id = v_ua and p.competence_month = m1 and s.close_seq = 1;
  rep := rep || pg_temp.res(n = 5, 'snapshot da versão 1 é preservado como evidência histórica');

  -- ---- exportação
  x := public.acc_export_data(v_ua, m1);
  rep := rep || pg_temp.res(not (x->>'provisional')::boolean and x->>'period_status' = 'closed' and jsonb_array_length(x->'entries') >= 5 and jsonb_array_length(x->'documents') = 1, 'exportação de competência fechada: definitiva, ambas as bases e 1 documento');
  rep := rep || pg_temp.res(exists (select 1 from jsonb_array_elements(x->'entries') e where e->>'basis' = 'competencia') and exists (select 1 from jsonb_array_elements(x->'entries') e where e->>'basis' = 'caixa'), 'exportação separa competência e caixa (coluna basis)');
  rep := rep || pg_temp.res(exists (select 1 from jsonb_array_elements(x->'entries') e where e->>'account_code' = 'N04D2'), 'exportação leva a classificação (código e nome)');
  x := public.acc_export_data(v_ua, m2);
  rep := rep || pg_temp.res((x->>'provisional')::boolean, 'exportação de competência não fechada é marcada como provisória');
  perform public.acc_export_log(v_ua, m1, 'zip', 5, 1, 'abc123');
  rep := rep || pg_temp.res(public.acc_export_list(v_ua)->0->>'format' = 'zip' and (public.acc_export_list(v_ua)->0->>'doc_count')::int = 1 and public.acc_export_list(v_ua)->0->>'period_status' = 'closed', 'histórico de exportações registra (a mais recente) formato, contagens e situação da competência');
  reset role;
  select count(*) into n from public.audit_log where action = 'acc_export' and actor_user_id = u_fin;
  rep := rep || pg_temp.res(n = 1, 'exportação auditada');
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  x := public.acc_export_data(v_ua, m1);
  rep := rep || pg_temp.res(not (x->>'names_visible')::boolean and not exists (select 1 from jsonb_array_elements(x->'entries') e where e->>'source_type' = 'receivable' and e->>'counterparty' not like 'Paciente %'), 'exportação para o contador: pacientes pseudonimizados');
  reset role;

  raise exception E'RELATORIO_N04_CONTABIL_JORNADA (transação desfeita):%', rep;
end $$;
