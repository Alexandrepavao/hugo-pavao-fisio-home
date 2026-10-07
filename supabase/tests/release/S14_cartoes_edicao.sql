-- RELEASE v1 — S14: edição de cartões corporativos (migration 066): permissões, validações, auditoria (com motivo), faturas existentes preservadas e efeito nos ciclos futuros.
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; acc_a uuid; cat uuid;
  u_fa uuid := gen_random_uuid(); u_fb uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  card uuid; card3 uuid; p_old uuid; p_now uuid; p_now2 uuid; p_gap uuid; p_c3 uuid; inv_old uuid; inv_cur uuid; inv_cur2 uuid; inv_gap uuid; inv_b uuid; inv_c3 uuid;
  t date := private.card_today(); v_close int; v_due int; nclose int; ndue int; rep text := ''; j jsonb; e text; n bigint; ok boolean;
  snap1 text; snap2 text; psnap1 text; psnap2 text; sum1 jsonb; sum2 jsonb; m0 date; last_close date; d date; r record; c3_closing date;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S14)', 'teste-a-s14') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S14)', 'teste-b-s14') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_fa,'authenticated','authenticated','fa@s14.local'),(u_fb,'authenticated','authenticated','fb@s14.local'),(u_sales,'authenticated','authenticated','s@s14.local'),(u_phy,'authenticated','authenticated','p@s14.local');
  insert into public.user_accounts (user_id, org_id, person_id, status) values (u_fa, v_org, null, 'active'),(u_fb, v_org, null, 'active'),(u_sales, v_org, null, 'active'),(u_phy, v_org, null, 'active');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_fa, 'finance', ua),(v_org, u_fb, 'finance', ub),(v_org, u_sales, 'sales', ua),(v_org, u_phy, 'physio', ua);
  insert into public.financial_accounts (org_id, unit_id, name, kind) values (v_org, ua, 'Conta A S14', 'bank') returning id into acc_a;
  insert into public.finance_categories (org_id, name, kind) values (v_org, 'Categoria cartão S14', 'expense') returning id into cat;
  v_close := ((extract(day from t)::int + 6) % 28) + 1;                      -- nunca coincide com hoje: a fatura corrente fica aberta
  v_due := ((v_close + 9) % 28) + 1;
  nclose := ((v_close + 7) % 28) + 1; ndue := ((nclose + 4) % 28) + 1;       -- novos dias, diferentes dos antigos

  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  card := public.card_create(ua, 'Cartão Edição S14', 'Banco Teste', 'visa', 500000, v_close, v_due, '4321', 'Responsável', acc_a);
  p_old := public.card_purchase_create(card, t - 45, 10000, 'Compra antiga S14', 'Loja A', cat, 'physio');
  p_now := public.card_purchase_create(card, t, 20000, 'Compra de hoje S14', 'Loja B', cat, 'academy');
  reset role;
  select invoice_id into inv_old from public.card_purchases where id = p_old; select invoice_id into inv_cur from public.card_purchases where id = p_now;
  rep := rep || pg_temp.chk(inv_old <> inv_cur, 'a compra antiga e a de hoje estão em faturas diferentes (uma histórica, uma corrente)');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  perform public.card_invoice_pay(inv_old, acc_a);                           -- fatura histórica: fechada e paga
  reset role;

  -- ============ 1) permissões
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fb, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, %s, ''Teste de permissão'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '42501%', 'financeiro da unidade B NÃO edita cartão da unidade A (42501)');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, %s, ''Teste de permissão'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '42501%', 'comercial NÃO edita cartão (42501)');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, %s, ''Teste de permissão'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '42501%', 'fisioterapeuta NÃO edita cartão (42501)');
  reset role; set local role anon;
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, %s, ''Teste de permissão'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '42501%', 'anon NÃO edita cartão (42501)');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  e := pg_temp.err(format('update public.corporate_cards set credit_limit_cents = 999999999 where id = %L', card)); rep := rep || pg_temp.chk(e like '42501%', 'atualização direta da tabela continua bloqueada (só pela função)');
  e := pg_temp.err('select private.card_cycle_for(gen_random_uuid(), current_date)'); rep := rep || pg_temp.chk(e like '42501%', 'a função privada de ciclo não é chamada pelo navegador');
  select credit_limit_cents = 500000 and closing_day = v_close and due_day = v_due into ok from public.corporate_cards where id = card; rep := rep || pg_temp.chk(ok, 'nenhuma tentativa negada alterou o cartão');

  -- ============ 2) validações
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, %s, ''ab'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '%motivo%', 'motivo curto é recusado');
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, %s, null)', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '%motivo%', 'motivo nulo é recusado');
  e := pg_temp.err(format('select public.card_update(%L, 0, %s, %s, ''Limite zero'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '%maior que zero%', 'limite zero é recusado');
  e := pg_temp.err(format('select public.card_update(%L, -5, %s, %s, ''Limite negativo'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '%maior que zero%', 'limite negativo é recusado');
  e := pg_temp.err(format('select public.card_update(%L, 600000, 0, %s, ''Dia inválido'')', card, ndue)); rep := rep || pg_temp.chk(e like '%entre os dias 1 e 28%', 'fechamento 0 é recusado');
  e := pg_temp.err(format('select public.card_update(%L, 600000, %s, 29, ''Dia inválido'')', card, nclose)); rep := rep || pg_temp.chk(e like '%entre os dias 1 e 28%', 'vencimento 29 é recusado');
  e := pg_temp.err(format('select public.card_update(%L, 500000, %s, %s, ''Sem mudança'')', card, v_close, v_due)); rep := rep || pg_temp.chk(e like '%nenhuma alteração%', 'edição sem nenhuma diferença é recusada');
  e := pg_temp.err(format('select public.card_update(%L, 19999, %s, %s, ''Limite abaixo do aberto'')', card, nclose, ndue)); rep := rep || pg_temp.chk(e like '%abaixo do que já está em aberto%' and e like '%200,00%', 'limite abaixo do que está em aberto (R$ 200,00; a fatura histórica já paga não conta) é recusado');
  select credit_limit_cents = 500000 and closing_day = v_close and due_day = v_due into ok from public.corporate_cards where id = card; rep := rep || pg_temp.chk(ok, 'as recusas não alteraram nada');
  e := pg_temp.err(format('select public.card_update(%L, 20000, %s, %s, ''Limite no valor em aberto'')', card, v_close, v_due)); rep := rep || pg_temp.chk(e is null, 'limite exatamente igual ao em aberto (R$ 200,00) é aceito');
  select credit_limit_cents = 20000 into ok from public.corporate_cards where id = card; rep := rep || pg_temp.chk(ok, 'o limite ficou em R$ 200,00 e o disponível em R$ 0,00');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 100, ''Estoura o limite S14'')', card)); rep := rep || pg_temp.chk(e like '%limite insuficiente%', 'com o limite reduzido, uma nova compra acima do disponível é recusada');

  -- ============ 3) faturas existentes preservadas
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'cs', i.cycle_start, 'cd', i.closing_date, 'dd', i.due_date, 'st', i.status, 'pt', i.paid_total_cents, 'pa', i.paid_at) order by i.closing_date), '[]')::text into snap1 from public.card_invoices i where i.card_id = card;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'dd', b.due_date, 'cm', b.competence_month, 'st', b.status, 'am', b.amount_cents, 'bl', b.business_line) order by b.id), '[]')::text into psnap1
    from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = card;
  sum1 := (select x from jsonb_array_elements(public.card_summary(ua)) x where x ->> 'id' = card::text);
  select max(closing_date) into last_close from public.card_invoices where card_id = card;
  j := public.card_update(card, 800000, nclose, ndue, 'Reajuste pelo banco');
  rep := rep || pg_temp.chk(j -> 'changed' @> '["credit_limit_cents","closing_day","due_day"]'::jsonb and (j ->> 'applies_from')::date = last_close + 1 and (j ->> 'existing_invoices_kept')::boolean, 'a função informa o que mudou e a partir de quando os novos dias valem (depois do último fechamento já faturado)');
  select (credit_limit_cents, closing_day, due_day) = (800000, nclose, ndue) into ok from public.corporate_cards where id = card; rep := rep || pg_temp.chk(ok, 'limite, fechamento e vencimento do cartão foram atualizados');
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'cs', i.cycle_start, 'cd', i.closing_date, 'dd', i.due_date, 'st', i.status, 'pt', i.paid_total_cents, 'pa', i.paid_at) order by i.closing_date), '[]')::text into snap2 from public.card_invoices i where i.card_id = card;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'dd', b.due_date, 'cm', b.competence_month, 'st', b.status, 'am', b.amount_cents, 'bl', b.business_line) order by b.id), '[]')::text into psnap2
    from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = card;
  rep := rep || pg_temp.chk(snap1 = snap2, 'TODAS as faturas existentes (histórica paga e corrente aberta) mantêm ciclo, fechamento, vencimento, situação e valor pago');
  rep := rep || pg_temp.chk(psnap1 = psnap2, 'as despesas das compras existentes mantêm vencimento, competência, situação, valor e linha de negócio');
  sum2 := (select x from jsonb_array_elements(public.card_summary(ua)) x where x ->> 'id' = card::text);
  rep := rep || pg_temp.chk((sum2 ->> 'closing_date') = (sum1 ->> 'closing_date') and (sum2 ->> 'due_date') = (sum1 ->> 'due_date') and (sum2 ->> 'cycle_start') = (sum1 ->> 'cycle_start'), 'o resumo continua mostrando o ciclo/fechamento/vencimento da fatura corrente que já existia');
  rep := rep || pg_temp.chk((sum2 ->> 'closing_day')::int = nclose and (sum2 ->> 'due_day')::int = ndue and (sum2 ->> 'credit_limit_cents')::bigint = 800000 and (sum2 ->> 'available_cents')::bigint = 780000, 'o resumo mostra os novos dias e o novo limite (disponível = R$ 7.800,00)');
  -- compra de hoje, depois da mudança: continua na fatura corrente existente, com o vencimento antigo
  p_now2 := public.card_purchase_create(card, t, 5000, 'Compra de hoje depois da mudança S14', 'Loja C', cat, 'shared');
  select invoice_id into inv_cur2 from public.card_purchases where id = p_now2;
  rep := rep || pg_temp.chk(inv_cur2 = inv_cur, 'compra feita depois da mudança, em data coberta pela fatura corrente, entra nessa mesma fatura');
  select (b.due_date = (select due_date from public.card_invoices where id = inv_cur)) into ok from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.id = p_now2;
  rep := rep || pg_temp.chk(ok, 'e a despesa dela vence na data (antiga) da fatura existente, não na do novo dia de vencimento');
  e := pg_temp.err(format('select public.card_purchase_create(%L, %L, 100, ''Na fatura paga S14'')', card, t - 45)); rep := rep || pg_temp.chk(e like '%já foi paga%', 'compra em data da fatura histórica já paga continua recusada');
  reset role;
  select coalesce(sum(amount_cents), 0) into n from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = card and cp.cancelled_at is null and b.status = 'open';
  rep := rep || pg_temp.chk(n = 25000, 'valor em aberto do cartão = R$ 250,00 (compra de hoje + a de depois da mudança)');

  -- ============ 4) ciclos futuros usam os novos dias
  select * into r from private.card_cycle_for(card, last_close + 20);
  rep := rep || pg_temp.chk(r.invoice_id is null and not r.overlaps and (r.closing_date, r.due_date) = (select c.closing_date, c.due_date from private.card_cycle(nclose, ndue, last_close + 20) c) and r.cycle_start >= last_close + 1,
    'uma data depois do último fechamento já faturado calcula o ciclo com os NOVOS dias (início nunca antes do fechamento anterior + 1)');
  rep := rep || pg_temp.chk(extract(day from r.closing_date)::int = nclose, 'o fechamento desse ciclo cai no novo dia ' || nclose);
  -- compra retroativa em período que nenhuma fatura cobre: usa os novos dias
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  perform public.card_update(card, 900000, nclose, ndue, 'Aumento de limite para o teste');
  p_gap := public.card_purchase_create(card, t - 200, 7000, 'Retroativa sem fatura S14', 'Loja D', cat, 'unclassified');
  reset role;
  select cp.invoice_id into inv_gap from public.card_purchases cp where cp.id = p_gap;
  select (extract(day from closing_date)::int = nclose and (closing_date, due_date) = (select c.closing_date, c.due_date from private.card_cycle(nclose, ndue, t - 200) c)) into ok from public.card_invoices where id = inv_gap;
  rep := rep || pg_temp.chk(ok, 'compra retroativa em período sem fatura cria a fatura com os novos dias de fechamento e vencimento');

  -- ============ 5) cartão bloqueado também pode ser editado; mudança que sobreporia fatura existente é recusada
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  card3 := public.card_create(ua, 'Cartão Sobreposição S14', 'Banco Teste', 'mastercard', 300000, 10, 18, null, null, acc_a);
  m0 := date_trunc('month', t - interval '4 months')::date;
  reset role;
  c3_closing := (m0 + interval '1 month')::date + 9;                          -- dia 10 do mês seguinte a m0
  insert into public.card_invoices (org_id, unit_id, card_id, cycle_start, closing_date, due_date) values (v_org, ua, card3, m0 + 10, c3_closing, c3_closing + 8) returning id into inv_b;
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  perform public.card_set_status(card3, 'blocked', 'Cartão extraviado');
  e := pg_temp.err(format('select public.card_update(%L, 350000, 20, 28, ''Novo contrato do emissor'')', card3)); rep := rep || pg_temp.chk(e is null, 'cartão bloqueado pode ter limite e dias editados (continua bloqueado)');
  select status = 'blocked' and closing_day = 20 and due_day = 28 and credit_limit_cents = 350000 into ok from public.corporate_cards where id = card3; rep := rep || pg_temp.chk(ok, 'o bloqueio foi mantido pela edição');
  perform public.card_set_status(card3, 'active', null);
  e := pg_temp.err(format('select public.card_purchase_create(%L, %L, 1000, ''Sobrepõe fatura S14'')', card3, m0 + 4)); rep := rep || pg_temp.chk(e like '%dias anteriores do cartão%', 'compra retroativa cujo ciclo (novo fechamento dia 20) invadiria a fatura existente é recusada com explicação');
  select count(*) into n from public.card_invoices where card_id = card3; rep := rep || pg_temp.chk(n = 1, 'e nenhuma fatura nova ou alterada foi criada por essa tentativa');
  p_c3 := public.card_purchase_create(card3, t, 4000, 'Depois do último fechamento S14', 'Loja E', cat, 'physio');
  reset role;
  select cp.invoice_id into inv_c3 from public.card_purchases cp where cp.id = p_c3;
  select (extract(day from closing_date)::int = 20 and due_date = (select c.due_date from private.card_cycle(20, 28, t) c) and cycle_start > c3_closing) into ok from public.card_invoices where id = inv_c3;
  rep := rep || pg_temp.chk(ok, 'compra de hoje (depois do último fechamento) cria a fatura com os novos dias 20/28, sem sobrepor a anterior');
  select (cycle_start = m0 + 10 and closing_date = c3_closing and due_date = c3_closing + 8 and status = 'open') into ok from public.card_invoices where id = inv_b;
  rep := rep || pg_temp.chk(ok, 'a fatura anterior (dias antigos 10/18) ficou intacta');

  -- ============ 6) auditoria
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'corporate_cards' and entity_id = card::text and new_values ->> 'reason' = 'Reajuste pelo banco'
     and actor_user_id = u_fa and old_values ->> 'credit_limit_cents' = '20000' and (new_values ->> 'credit_limit_cents')::bigint = 800000 and (old_values ->> 'closing_day')::int = v_close and (new_values ->> 'closing_day')::int = nclose
     and (old_values ->> 'due_day')::int = v_due and (new_values ->> 'due_day')::int = ndue and changed_columns @> array['credit_limit_cents','closing_day','due_day'] and (new_values ->> 'existing_invoices_kept')::boolean;
  rep := rep || pg_temp.chk(n = 1, 'a edição foi auditada com autor, motivo, valores antigos e novos, e a informação de que as faturas existentes foram mantidas');
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'corporate_cards' and entity_id = card::text and action = 'update' and changed_columns @> array['closing_day'] and new_values ->> 'reason' is null;
  rep := rep || pg_temp.chk(n >= 1, 'o gatilho de auditoria da tabela também registrou a alteração de fechamento');
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'corporate_cards' and entity_id = card::text and action = 'update' and new_values ->> 'reason' = 'Limite no valor em aberto';
  rep := rep || pg_temp.chk(n = 1, 'a edição só do limite também foi auditada com o próprio motivo');
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'corporate_cards' and entity_id = card::text and new_values ->> 'reason' in ('ab','Sem mudança','Limite zero','Limite abaixo do aberto');
  rep := rep || pg_temp.chk(n = 0, 'tentativas recusadas não geram auditoria de alteração');

  raise exception E'RELATORIO_S14_CARTOES_EDICAO (transação desfeita):%', rep;
end $$;
