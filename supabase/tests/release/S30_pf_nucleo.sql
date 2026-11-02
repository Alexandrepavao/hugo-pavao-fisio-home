-- RELEASE — S30: Finanças pessoais — acesso, recorrências, parcelamentos, liquidações, cartão e idempotência (migrations 092–093). Transação sempre desfeita. Somente Dev/teste.
--  · só o proprietário autorizado (pf_access + recurso ligado) lê/grava; gestor, financeiro, comercial e anônimo não; um dono não enxerga o outro
--  · despesa fixa mensal com término após 6 ocorrências; conta variável recorrente (previsão substituída pelo valor real); anual e dia 31; "a cada 14 dias" ≠ "duas vezes por mês"
--  · parcelado com divisão exata em centavos; compra no cartão e fatura (uma despesa só); pagamento parcial, cancelamento e estorno
--  · editar somente esta / esta e as próximas / toda a série sem tocar no liquidado; pausar e retomar; encerrar preservando o passado
--  · reexecutar com a mesma chave não duplica nada
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.dts(sid uuid, a date, b date) returns text language sql security definer as $$ select coalesce(string_agg(occ_date::text, ',' order by occ_date), '') from private.pf_occurrences(sid, a, b) $$;
do $$
declare
  v_org uuid; u_own uuid := gen_random_uuid(); u_own2 uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_none uuid := gen_random_uuid();
  rep text := ''; r jsonb; r2 jsonb; acc uuid; acc2 uuid; card uuid; cat_exp uuid; cat_inc uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; e1 uuid; n int; t text; inv uuid; ids jsonb; g uuid; amt bigint[]; v bigint;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  update public.organizations set features = features || '{"personal_finance": true}'::jsonb where id = v_org;
  insert into auth.users (id, aud, role, email) values (u_own,'authenticated','authenticated','own@s30.local'),(u_own2,'authenticated','authenticated','own2@s30.local'),(u_mgr,'authenticated','authenticated','mgr@s30.local'),
    (u_fin,'authenticated','authenticated','fin@s30.local'),(u_none,'authenticated','authenticated','none@s30.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_own, v_org, 'Dono S30'),(u_own2, v_org, 'Dono2 S30'),(u_mgr, v_org, 'Gestor S30'),(u_fin, v_org, 'Financeiro S30'),(u_none, v_org, 'Sem papel S30');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_own, 'manager', null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) select v_org, u_fin, 'finance', id from public.units where org_id = v_org limit 1;
  insert into public.pf_access (org_id, user_id) values (v_org, u_own),(v_org, u_own2);

  -- ============ 1) acesso
  set local role authenticated;
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk((public.pf_my_access() ->> 'enabled')::boolean = false, 'gestor (papel manager) SEM autorização: acesso negado');
  rep := rep || pg_temp.chk(pg_temp.err('select public.pf_bootstrap()') like '42501%', 'gestor não prepara/usa as finanças pessoais');
  perform pg_temp.as_user(u_fin);
  rep := rep || pg_temp.chk((public.pf_my_access() ->> 'enabled')::boolean = false and pg_temp.err('select public.pf_account_save(null, ''Conta X'', ''checking'', 0, current_date, false)') like '42501%', 'financeiro: acesso negado (inclusive criando conta pela API)');
  perform pg_temp.as_user(u_none);
  rep := rep || pg_temp.chk((public.pf_my_access() ->> 'enabled')::boolean = false, 'usuário sem papel: acesso negado');
  perform pg_temp.as_user(u_own);
  rep := rep || pg_temp.chk((public.pf_my_access() ->> 'enabled')::boolean, 'proprietário autorizado: acesso liberado');
  r := public.pf_bootstrap(); r2 := public.pf_bootstrap();
  rep := rep || pg_temp.chk((r ->> 'categories')::int > 0 and (r2 ->> 'categories')::int = 0, 'categorias padrão criadas uma única vez (reexecutar não duplica)');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.pf_my_access()') is not null and pg_temp.err('select count(*) from public.pf_entries') is not null, 'anônimo: sem acesso à função nem às tabelas');
  reset role;
  update public.organizations set features = features - 'personal_finance' where id = v_org;
  set local role authenticated; perform pg_temp.as_user(u_own);
  rep := rep || pg_temp.chk((public.pf_my_access() ->> 'enabled')::boolean = false and pg_temp.err('select public.pf_bootstrap()') like '42501%', 'recurso desligado na organização: nem o proprietário acessa (habilitação por organização)');
  reset role; update public.organizations set features = features || '{"personal_finance": true}'::jsonb where id = v_org;
  update public.pf_access set revoked_at = now() where user_id = u_own2;
  set local role authenticated; perform pg_temp.as_user(u_own2);
  rep := rep || pg_temp.chk((public.pf_my_access() ->> 'enabled')::boolean = false, 'acesso revogado tem efeito imediato');
  reset role; update public.pf_access set revoked_at = null where user_id = u_own2;

  -- ============ 2) cadastros do proprietário
  set local role authenticated; perform pg_temp.as_user(u_own);
  acc := public.pf_account_save(null, 'Conta corrente S30', 'checking', 100000, date '2026-01-01', false);
  acc2 := public.pf_account_save(null, 'Reserva S30', 'savings', 0, date '2026-01-01', true);
  card := public.pf_card_save(null, 'Cartão S30', 'Banco S30', 'visa', 500000, 10, 20, '1234', acc);
  select id into cat_exp from public.pf_categories where owner_user_id = u_own and name = 'Moradia' and kind = 'expense';
  select id into cat_inc from public.pf_categories where owner_user_id = u_own and name = 'Salário e pró-labore';
  rep := rep || pg_temp.chk(pg_temp.err('select public.pf_card_save(null, ''Ruim'', ''Banco'', ''visa'', 1000, 10, 20, ''12345678'')') like '%4 últimos%', 'cartão: só os 4 últimos dígitos (nunca o número completo)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.pf_card_save(null, ''Ruim2'', ''Banco'', ''visa'', 1000, 31, 20)') like '%dias 1 e 28%', 'cartão: fechamento/vencimento entre 1 e 28');

  -- ============ 3) isolamento entre usuários e contra o gestor (API direta)
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Conta privada S30','amount_cents',12345,'due_date','2026-06-10','category_id',cat_exp,'account_id',acc,'idempotency_key','s30-priv'));
  e1 := (r ->> 'id')::uuid;
  select count(*) into n from public.pf_entries; rep := rep || pg_temp.chk(n = 1, 'o dono lê o próprio lançamento');
  perform pg_temp.as_user(u_own2);
  select count(*) into n from public.pf_entries; rep := rep || pg_temp.chk(n = 0, 'outro proprietário autorizado NÃO vê o lançamento (cada um tem os próprios dados)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_settle(jsonb_build_object(''entry_id'', %L), 100, current_date, %L)', e1, acc)) is not null, 'outro proprietário não liquida o lançamento alheio');
  perform pg_temp.as_user(u_mgr);
  select count(*) into n from public.pf_entries; rep := rep || pg_temp.chk(n = 0, 'gestor NÃO lê lançamentos pessoais (nem por consulta direta)');
  select count(*) into n from public.pf_accounts; rep := rep || pg_temp.chk(n = 0, 'gestor NÃO lê contas pessoais');
  rep := rep || pg_temp.chk(pg_temp.err('insert into public.pf_entries (org_id, owner_user_id, kind, description, competence_date, due_date, original_due_date, amount_cents) values (null, null, ''expense'', ''x'', current_date, current_date, current_date, 1)') like '42501%', 'ninguém grava direto nas tabelas (só pelas funções)');
  perform pg_temp.as_user(u_fin);
  select count(*) into n from public.pf_settlements; rep := rep || pg_temp.chk(n = 0, 'financeiro NÃO lê liquidações pessoais');
  perform pg_temp.as_user(u_own);

  -- ============ 4) despesa FIXA mensal com término após 6 ocorrências (aluguel dia 5)
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Aluguel S30','amount_cents',250000,'category_id',cat_exp,'account_id',acc,'nature','fixed','repetition','recurring','idempotency_key','s30-aluguel',
         'recurrence', jsonb_build_object('frequency','monthly','start_date','2026-01-05','due_day',5,'end_mode','count','end_count',6)));
  s1 := (r ->> 'id')::uuid;
  rep := rep || pg_temp.chk(pg_temp.dts(s1, date '2026-01-01', date '2027-12-31') = '2026-01-05,2026-02-05,2026-03-05,2026-04-05,2026-05-05,2026-06-05', 'aluguel fixo/recorrente: exatamente 6 ocorrências (jan–jun) e nenhuma depois');
  r2 := public.pf_entry_create(jsonb_build_object('kind','expense','description','Aluguel S30','amount_cents',250000,'category_id',cat_exp,'account_id',acc,'nature','fixed','repetition','recurring','idempotency_key','s30-aluguel',
         'recurrence', jsonb_build_object('frequency','monthly','start_date','2026-01-05','due_day',5,'end_mode','count','end_count',6)));
  select count(*) into n from public.pf_series where owner_user_id = u_own and description = 'Aluguel S30'; rep := rep || pg_temp.chk(n = 1 and (r2 ->> 'duplicate')::boolean, 'reenviar a mesma recorrência NÃO duplica');
  select count(*) into n from public.pf_entries where series_id = s1; rep := rep || pg_temp.chk(n = 0, 'nada é gravado além da regra (ocorrências futuras são calculadas)');

  -- ============ 5) conta VARIÁVEL recorrente: previsão substituída pelo valor real
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Energia S30','amount_cents',25000,'category_id',cat_exp,'account_id',acc,'nature','variable','repetition','recurring',
         'recurrence', jsonb_build_object('frequency','monthly','start_date','2026-01-10','due_day',10)));
  s2 := (r ->> 'id')::uuid;
  r := public.pf_entry_settle(jsonb_build_object('series_id', s2, 'occurrence_date', '2026-01-10'), 31234, date '2026-01-10', acc, true, 's30-energia-jan');
  select * into e1, v from (select id, amount_cents from public.pf_entries where series_id = s2 and occurrence_date = date '2026-01-10') x;
  rep := rep || pg_temp.chk(v = 31234 and (select estimated_cents from public.pf_entries where id = e1) = 25000 and (select status from public.pf_entries where id = e1) = 'settled' and (select is_estimate from public.pf_entries where id = e1) = false,
                            'variável: o valor real (R$ 312,34) substitui a previsão (R$ 250,00), que fica guardada; lançamento liquidado');
  rep := rep || pg_temp.chk(pg_temp.dts(s2, date '2026-02-01', date '2026-02-28') = '2026-02-10' and not exists (select 1 from public.pf_entries where series_id = s2 and occurrence_date = date '2026-02-10'), 'o mês seguinte continua virtual, com a estimativa');
  r2 := public.pf_entry_settle(jsonb_build_object('series_id', s2, 'occurrence_date', '2026-01-10'), 31234, date '2026-01-10', acc, true, 's30-energia-jan');
  select count(*) into n from public.pf_settlements where entry_id = e1; rep := rep || pg_temp.chk(n = 1 and (r2 ->> 'duplicate')::boolean, 'repetir a liquidação com a mesma chave não duplica o pagamento');

  -- ============ 6) anual e vencimento no dia 31; "a cada 14 dias" ≠ "duas vezes por mês"
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','IPTU S30','amount_cents',120000,'category_id',cat_exp,'account_id',acc,'repetition','recurring',
         'recurrence', jsonb_build_object('frequency','annual','start_date','2026-03-31','due_day',31)));
  s3 := (r ->> 'id')::uuid;
  rep := rep || pg_temp.chk(pg_temp.dts(s3, date '2026-01-01', date '2029-12-31') = '2026-03-31,2027-03-31,2028-03-31,2029-03-31', 'despesa anual: uma ocorrência por ano, no dia 31');
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Dia 31 S30','amount_cents',10000,'repetition','recurring','recurrence', jsonb_build_object('frequency','monthly','start_date','2027-12-31','due_day',31)));
  rep := rep || pg_temp.chk(pg_temp.dts((r ->> 'id')::uuid, date '2028-01-01', date '2028-06-30') = '2028-01-31,2028-02-29,2028-03-31,2028-04-30,2028-05-31,2028-06-30', 'vencimento dia 31: mês menor usa o último dia (29/02/2028 bissexto, 30/04, 30/06)');
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','A cada 14 dias S30','amount_cents',5000,'repetition','recurring','recurrence', jsonb_build_object('frequency','biweekly','start_date','2026-01-01')));
  rep := rep || pg_temp.chk(pg_temp.dts((r ->> 'id')::uuid, date '2026-01-01', date '2026-02-28') = '2026-01-01,2026-01-15,2026-01-29,2026-02-12,2026-02-26', '"a cada 14 dias": 1/1, 15/1, 29/1, 12/2, 26/2 (3 em janeiro)');
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Duas vezes por mês S30','amount_cents',5000,'repetition','recurring','recurrence', jsonb_build_object('frequency','semimonthly','start_date','2026-01-01','due_day',5,'due_day2',20)));
  rep := rep || pg_temp.chk(pg_temp.dts((r ->> 'id')::uuid, date '2026-01-01', date '2026-03-31') = '2026-01-05,2026-01-20,2026-02-05,2026-02-20,2026-03-05,2026-03-20', '"duas vezes por mês": dias 5 e 20, sempre 2 por mês');
  rep := rep || pg_temp.chk(pg_temp.err('select public.pf_entry_create(jsonb_build_object(''kind'',''expense'',''description'',''Ruim'',''amount_cents'',1,''repetition'',''recurring'',''recurrence'', jsonb_build_object(''frequency'',''semimonthly'',''start_date'',''2026-01-01'',''due_day'',5)))') like '%dois dias%', 'duas vezes por mês exige os dois dias');

  -- ============ 7) parcelado: divisão exata dos centavos e idempotência
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Notebook S30','repetition','installment','category_id',cat_exp,'account_id',acc,'idempotency_key','s30-notebook',
         'installments', jsonb_build_object('count',3,'total_cents',10000,'first_date','2026-02-28')));
  select array_agg(amount_cents order by installment_no) into amt from public.pf_entries where installment_group = (r ->> 'group')::uuid;
  rep := rep || pg_temp.chk(amt = array[3334::bigint, 3333, 3333] and (select sum(x) from unnest(amt) x) = 10000, 'R$ 100,00 em 3 parcelas: 33,34 + 33,33 + 33,33 (soma exata)');
  rep := rep || pg_temp.chk((select string_agg(due_date::text, ',' order by installment_no) from public.pf_entries where installment_group = (r ->> 'group')::uuid) = '2026-02-28,2026-03-28,2026-04-28', 'vencimentos mensais das parcelas');
  r2 := public.pf_entry_create(jsonb_build_object('kind','expense','description','Notebook S30','repetition','installment','category_id',cat_exp,'account_id',acc,'idempotency_key','s30-notebook',
         'installments', jsonb_build_object('count',3,'total_cents',10000,'first_date','2026-02-28')));
  select count(*) into n from public.pf_entries where description = 'Notebook S30'; rep := rep || pg_temp.chk(n = 3 and (r2 ->> 'duplicate')::boolean, 'refazer o parcelamento com a mesma chave NÃO duplica parcelas');
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Geladeira S30','repetition','installment','account_id',acc,'installments', jsonb_build_object('count',7,'total_cents',100001,'first_date','2026-01-31')));
  select array_agg(amount_cents order by installment_no) into amt from public.pf_entries where installment_group = (r ->> 'group')::uuid;
  rep := rep || pg_temp.chk((select sum(x) from unnest(amt) x) = 100001 and array_length(amt, 1) = 7 and amt[1] - amt[7] <= 1, 'R$ 1.000,01 em 7 parcelas soma exatamente 100001 centavos (diferença máxima de 1 centavo)');
  rep := rep || pg_temp.chk((select string_agg(due_date::text, ',' order by installment_no) from public.pf_entries where installment_group = (r ->> 'group')::uuid) = '2026-01-31,2026-02-28,2026-03-31,2026-04-30,2026-05-31,2026-06-30,2026-07-31', 'parcelas a partir do dia 31: meses menores no último dia');

  -- ============ 8) pagamento parcial, cancelamento e estorno
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Seguro S30','amount_cents',10000,'category_id',cat_exp,'account_id',acc,'due_date','2026-03-15'));
  e1 := (r ->> 'id')::uuid;
  r := public.pf_entry_settle(jsonb_build_object('entry_id', e1), 4000, date '2026-03-10', acc);
  rep := rep || pg_temp.chk((r ->> 'status') = 'partial' and (r ->> 'settled_cents')::int = 4000, 'pagamento parcial: situação "parcialmente liquidado"');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_settle(jsonb_build_object(''entry_id'', %L), 7000, date ''2026-03-11'', %L)', e1, acc)) like '%passa do previsto%', 'não paga acima do previsto (conta fixa)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_cancel(jsonb_build_object(''entry_id'', %L))', e1)) like '%estorne%', 'não cancela lançamento que já tem pagamento');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_settle(jsonb_build_object(''entry_id'', %L), 100, date ''2099-01-01'', %L)', e1, acc)) like '%futuro%', 'data de pagamento no futuro é recusada');
  r := public.pf_entry_settle(jsonb_build_object('entry_id', e1), 6000, date '2026-03-12', acc);
  rep := rep || pg_temp.chk((r ->> 'status') = 'settled', 'complementando o pagamento: liquidado');
  perform public.pf_settlement_void((select id from public.pf_settlements where entry_id = e1 and amount_cents = 6000));
  rep := rep || pg_temp.chk((select status from public.pf_entries where id = e1) = 'partial' and (select settled_cents from public.pf_entries where id = e1) = 4000, 'estornar a segunda liquidação volta para parcial (histórico preservado)');
  perform public.pf_settlement_void((select id from public.pf_settlements where entry_id = e1 and amount_cents = 4000));
  perform public.pf_entry_cancel(jsonb_build_object('entry_id', e1));
  rep := rep || pg_temp.chk((select status from public.pf_entries where id = e1) = 'cancelled' and (select count(*) from public.pf_settlements where entry_id = e1) = 2, 'após estornar, cancela; as liquidações estornadas continuam no histórico');

  -- ============ 9) cartão: uma despesa só; fatura paga sem duplicar
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Compra no cartão S30','amount_cents',15000,'category_id',cat_exp,'card_id',card,'purchase_date','2026-03-05','idempotency_key','s30-cartao'));
  e1 := (r ->> 'id')::uuid; select invoice_id into inv from public.pf_entries where id = e1;
  rep := rep || pg_temp.chk((select cycle_start || '|' || closing_date || '|' || due_date from public.pf_invoices where id = inv) = '2026-02-11|2026-03-10|2026-03-20', 'compra de 05/03 (fecha dia 10, vence dia 20): fatura 11/02–10/03, vence 20/03');
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Compra no cartão S30 B','amount_cents',5000,'card_id',card,'purchase_date','2026-03-12'));
  rep := rep || pg_temp.chk((select due_date from public.pf_entries where id = (r ->> 'id')::uuid) = date '2026-04-20', 'compra após o fechamento (12/03) cai na fatura seguinte (vence 20/04)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_settle(jsonb_build_object(''entry_id'', %L), 15000, date ''2026-03-20'', %L)', e1, acc)) like '%pague a fatura%', 'não liquida a compra do cartão direto (a obrigação é a fatura)');
  select count(*) into n from public.pf_entries where invoice_id = inv and status <> 'cancelled'; select coalesce(sum(amount_cents), 0) into v from public.pf_entries where invoice_id = inv and status <> 'cancelled';
  rep := rep || pg_temp.chk(v = 15000 and n = 1, 'a fatura soma as compras do ciclo (R$ 150,00)');
  r := public.pf_invoice_pay(inv, acc, 6000, date '2026-03-20', 's30-fat-1');
  rep := rep || pg_temp.chk((r ->> 'remaining_cents')::int = 9000 and (select status from public.pf_entries where id = e1) = 'open', 'pagamento parcial da fatura: restam R$ 90,00 e a compra segue aberta');
  r2 := public.pf_invoice_pay(inv, acc, 6000, date '2026-03-20', 's30-fat-1');
  select count(*) into n from public.pf_invoice_payments where invoice_id = inv and voided_at is null; rep := rep || pg_temp.chk(n = 1 and (r2 ->> 'duplicate')::boolean, 'repetir o pagamento da fatura com a mesma chave não duplica');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_invoice_pay(%L, %L, 9001, date ''2026-03-21'', null)', inv, acc)) like '%passa do que falta%', 'não paga mais que o saldo da fatura');
  perform public.pf_invoice_pay(inv, acc, 9000, date '2026-03-21', 's30-fat-2');
  rep := rep || pg_temp.chk((select status from public.pf_entries where id = e1) = 'settled' and (select count(*) from public.pf_entries where description like 'Compra no cartão S30%' and kind = 'expense') = 2, 'fatura quitada liquida a obrigação SEM criar nova despesa (continuam só as 2 compras)');

  -- ============ 10) edição: esta / esta e as próximas / toda a série; o liquidado não muda
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Plano de saúde S30','amount_cents',50000,'category_id',cat_exp,'account_id',acc,'repetition','recurring','recurrence', jsonb_build_object('frequency','monthly','start_date','2026-01-10','due_day',10)));
  s4 := (r ->> 'id')::uuid;
  perform public.pf_entry_settle(jsonb_build_object('series_id', s4, 'occurrence_date', '2026-01-10'), 50000, date '2026-01-10', acc);
  perform public.pf_entry_update(jsonb_build_object('series_id', s4, 'occurrence_date', '2026-04-10'), 'following', jsonb_build_object('amount_cents', 60000));
  select id into s3 from public.pf_series where parent_series_id = s4;
  rep := rep || pg_temp.chk(s3 is not null and (select ended_on from public.pf_series where id = s4) = date '2026-04-10' and (select start_date from public.pf_series where id = s3) = date '2026-04-10', 'esta e as próximas: a série antiga termina em 10/04 e a nova começa nessa data');
  rep := rep || pg_temp.chk((select amount_cents from public.pf_entries where series_id = s4 and occurrence_date = date '2026-01-10') = 50000 and (select status from public.pf_entries where series_id = s4 and occurrence_date = date '2026-01-10') = 'settled', 'janeiro (já liquidado) continua R$ 500,00');
  rep := rep || pg_temp.chk(pg_temp.dts(s4, date '2026-01-01', date '2026-12-31') = '2026-01-10,2026-02-10,2026-03-10' and pg_temp.dts(s3, date '2026-01-01', date '2026-06-30') = '2026-04-10,2026-05-10,2026-06-10', 'a série antiga gera jan–mar e a nova abr em diante (sem duplicar datas)');
  perform public.pf_entry_update(jsonb_build_object('series_id', s3, 'occurrence_date', '2026-05-10'), 'this', jsonb_build_object('amount_cents', 70000));
  rep := rep || pg_temp.chk((select amount_cents from public.pf_entries where series_root_id = s4 and occurrence_date = date '2026-05-10') = 70000 and (select overridden from public.pf_entries where series_root_id = s4 and occurrence_date = date '2026-05-10'), 'somente esta (maio): R$ 700,00 e marcada como editada à parte');
  perform public.pf_entry_update(jsonb_build_object('series_id', s3, 'occurrence_date', '2026-06-10'), 'all', jsonb_build_object('description', 'Plano de saúde S30 (novo)', 'amount_cents', 65000));
  rep := rep || pg_temp.chk((select amount_cents from public.pf_series where id = s3) = 65000 and (select amount_cents from public.pf_entries where series_root_id = s4 and occurrence_date = date '2026-05-10') = 70000
                            and (select amount_cents from public.pf_entries where series_root_id = s4 and occurrence_date = date '2026-01-10') = 50000, 'toda a série: nova regra R$ 650,00; maio (editada à parte) e janeiro (liquidado) não mudam');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_update(jsonb_build_object(''series_id'', %L, ''occurrence_date'', ''2026-06-10''), ''all'', jsonb_build_object(''frequency'', ''weekly''))', s3)) like '%esta e as próximas%', 'mudar a frequência só pelo alcance "esta e as próximas"');
  -- reagendar uma ocorrência: preserva a data original
  r := public.pf_entry_update(jsonb_build_object('series_id', s3, 'occurrence_date', '2026-07-10'), 'this', jsonb_build_object('due_date', '2026-07-15'));
  rep := rep || pg_temp.chk((select due_date from public.pf_entries where id = (r ->> 'entry_id')::uuid) = date '2026-07-15' and (select original_due_date from public.pf_entries where id = (r ->> 'entry_id')::uuid) = date '2026-07-10'
                            and exists (select 1 from public.pf_entry_events where entry_id = (r ->> 'entry_id')::uuid and kind = 'rescheduled'), 'reagendar 10/07 → 15/07 preserva a data original e registra no histórico');

  -- ============ 11) pausar/retomar e encerrar preservando o passado
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Streaming S30','amount_cents',3990,'account_id',acc,'repetition','recurring','recurrence', jsonb_build_object('frequency','monthly','start_date','2026-01-08','due_day',8,'end_mode','count','end_count',6)));
  s1 := (r ->> 'id')::uuid;
  perform public.pf_series_action(s1, 'pause', date '2026-04-01'); perform public.pf_series_action(s1, 'resume', date '2026-06-01');
  rep := rep || pg_temp.chk(pg_temp.dts(s1, date '2026-01-01', date '2026-12-31') = '2026-01-08,2026-02-08,2026-03-08,2026-06-08,2026-07-08,2026-08-08', 'pausa de abril e maio: pula esses meses e as 6 ocorrências terminam em agosto');
  perform public.pf_entry_settle(jsonb_build_object('series_id', s1, 'occurrence_date', '2026-01-08'), 3990, date '2026-01-08', acc);
  perform public.pf_entry_settle(jsonb_build_object('series_id', s1, 'occurrence_date', '2026-02-08'), 3990, date '2026-02-08', acc);
  perform public.pf_entry_cancel(jsonb_build_object('series_id', s1, 'occurrence_date', '2026-03-08'), 'following');
  rep := rep || pg_temp.chk(pg_temp.dts(s1, date '2026-01-01', date '2026-12-31') = '2026-01-08,2026-02-08' and (select count(*) from public.pf_entries where series_id = s1 and status = 'settled') = 2, 'cancelar a recorrência a partir de março: janeiro e fevereiro (liquidados) ficam, nada depois');
  rep := rep || pg_temp.chk((select status from public.pf_series where id = s1) = 'ended', 'recorrência encerrada');

  -- ============ 12) transferências e reserva (patrimônio, não despesa)
  r := public.pf_transfer_create(acc, acc2, 30000, date '2026-04-01', 'reserve', null, 'aporte S30', 's30-aporte');
  r2 := public.pf_transfer_create(acc, acc2, 30000, date '2026-04-01', 'reserve', null, 'aporte S30', 's30-aporte');
  select count(*) into n from public.pf_transfers where owner_user_id = u_own; rep := rep || pg_temp.chk(n = 1 and (r2 ->> 'duplicate')::boolean, 'aporte repetido com a mesma chave não duplica');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_transfer_create(%L, %L, 100, date ''2026-04-01'', ''reserve'')', acc2, acc)) like '%não compõe a reserva%', 'aporte em reserva exige conta de reserva no destino');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_transfer_create(%L, %L, 100, date ''2026-04-01'')', acc, acc)) like '%diferentes%', 'origem e destino precisam ser diferentes');
  select count(*) into n from public.pf_entries where kind = 'expense' and description ilike '%aporte%'; rep := rep || pg_temp.chk(n = 0, 'o aporte não vira despesa');

  raise exception E'RELATORIO_S30_PF_NUCLEO (transação desfeita):%', rep;
end $$;
