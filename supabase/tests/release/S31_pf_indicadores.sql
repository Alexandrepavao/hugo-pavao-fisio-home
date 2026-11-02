-- RELEASE — S31: Finanças pessoais — KPIs, custo de vida, calendário, cartão, reserva e lembretes (migration 094). Transação sempre desfeita. Somente Dev/teste.
-- Valores calculados à parte (aritmética simples sobre os dados do teste), nunca copiados da própria função. Datas relativas ao mês atual.
--   Mês atual: salário 8.000,00 recebido · aluguel fixo 2.500,00 pago · energia (variável, estimativa 300,00) paga 310,00 · compra no cartão 1.200,00 · TV 3×100,00 no cartão (1ª parcela hoje) · dentista 500,00 em aberto
--   Aluguel começou 3 meses atrás: 3 ocorrências vencidas e não pagas (7.500,00 vencidos).
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.kv(o jsonb, k text) returns bigint language sql as $$ select (o -> k ->> 'value')::bigint $$;
do $$
declare
  v_org uuid; u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); rep text := ''; v_cur date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date; v_eom date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date; acc uuid; res uuid; card uuid; cat_h uuid; cat_hs uuid; cat_s uuid; cat_i uuid; r jsonb; ov jsonb; lc jsonb; inv uuid; k text; d jsonb; n int; v bigint; ag jsonb; x jsonb;
  s_rent uuid; s_en uuid; s_water uuid; cf jsonb; rm jsonb; key text; acc_b uuid; cat_b uuid;
begin
  v_eom := (v_cur + interval '1 month - 1 day')::date;
  select id into v_org from public.organizations where slug = 'hp-group';
  update public.organizations set features = features || '{"personal_finance": true}'::jsonb where id = v_org;
  insert into auth.users (id, aud, role, email) values (u_a,'authenticated','authenticated','a@s31.local'),(u_b,'authenticated','authenticated','b@s31.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_a, v_org, 'Dono A S31'),(u_b, v_org, 'Dono B S31');
  insert into public.pf_access (org_id, user_id) values (v_org, u_a),(v_org, u_b);
  set local role authenticated; perform pg_temp.as_user(u_a);
  perform public.pf_bootstrap();
  select id into cat_h from public.pf_categories where owner_user_id = u_a and name = 'Moradia' and parent_id is null;
  select id into cat_hs from public.pf_categories where owner_user_id = u_a and name = 'Energia e água';
  select id into cat_s from public.pf_categories where owner_user_id = u_a and name = 'Saúde';
  select id into cat_i from public.pf_categories where owner_user_id = u_a and name = 'Salário e pró-labore';
  acc := public.pf_account_save(null, 'Conta A S31', 'checking', 100000, date '2026-01-01', false);
  res := public.pf_account_save(null, 'Reserva A S31', 'savings', 0, date '2026-01-01', true);
  card := public.pf_card_save(null, 'Cartão A S31', 'Banco', 'visa', 500000, 28, 5, '9999', acc);   -- fecha dia 28, vence dia 5 do mês seguinte (nunca vencida no mês do teste)

  -- dados do mês
  r := public.pf_entry_create(jsonb_build_object('kind','income','description','Salário S31','amount_cents',800000,'category_id',cat_i,'account_id',acc,'due_date',v_cur));
  perform public.pf_entry_settle(jsonb_build_object('entry_id', r ->> 'id'), 800000, v_cur, acc);
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Aluguel S31','amount_cents',250000,'category_id',cat_h,'account_id',acc,'nature','fixed','repetition','recurring',
        'recurrence', jsonb_build_object('frequency','monthly','start_date',(v_cur - interval '3 months')::date,'due_day',1)));
  s_rent := (r ->> 'id')::uuid;
  perform public.pf_entry_settle(jsonb_build_object('series_id', s_rent, 'occurrence_date', v_cur), 250000, v_cur, acc);
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Energia S31','amount_cents',30000,'category_id',cat_hs,'account_id',acc,'nature','variable','repetition','recurring',
        'recurrence', jsonb_build_object('frequency','monthly','start_date',v_cur,'due_day',1)));
  s_en := (r ->> 'id')::uuid;
  perform public.pf_entry_settle(jsonb_build_object('series_id', s_en, 'occurrence_date', v_cur), 31000, v_cur, acc, true);
  perform public.pf_entry_create(jsonb_build_object('kind','expense','description','Dentista S31','amount_cents',50000,'category_id',cat_s,'account_id',acc,'due_date',v_eom));
  perform public.pf_entry_create(jsonb_build_object('kind','expense','description','Compra cartão S31','amount_cents',120000,'category_id',cat_h,'card_id',card,'purchase_date',v_cur));
  perform public.pf_entry_create(jsonb_build_object('kind','expense','description','TV S31','repetition','installment','card_id',card,'installments', jsonb_build_object('count',3,'total_cents',30000,'first_date',v_cur)));

  -- ============ 1) KPIs do mês atual (conferidos à mão)
  ov := public.pf_overview(v_cur, v_eom);
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'income_received') = 800000, 'receitas recebidas = R$ 8.000,00');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'expense_realized') = 250000 + 31000 + 120000 + 10000, 'despesas realizadas = aluguel 2.500 + energia 310 + compra no cartão 1.200 + 1ª parcela da TV 100 = R$ 4.110,00 (fatura NÃO conta)');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'expense_expected') = 50000, 'despesas previstas do mês = dentista R$ 500,00');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'result_realized') = 800000 - 411000, 'resultado realizado = 8.000,00 − 4.110,00 = R$ 3.890,00');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'account_balance') = 100000 + 800000 - 250000 - 31000, 'saldo das contas = 1.000 + 8.000 − 2.500 − 310 = R$ 6.190,00 (limite do cartão não é saldo)');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'overdue') = 750000, 'vencidas = 3 aluguéis anteriores não pagos = R$ 7.500,00');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'fixed_expense') = 250000 + 120000 + 10000 + 50000 and pg_temp.kv(ov, 'variable_expense') = 31000, 'fixas = 4.300,00 (aluguel, cartão, TV, dentista) · variáveis = 310,00 (energia)');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'recurring_commitments') = 280000, 'compromissos recorrentes = 2.500 + 300 = R$ 2.800,00 por mês');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'invoices_next') = 150000, 'faturas em aberto = 1.300 (atual) + 100 + 100 (próximas) = R$ 1.500,00');
  rep := rep || pg_temp.chk((ov -> 'income_commitment_pct' ->> 'value')::numeric = 53.8, 'comprometimento da renda = fixas do mês 4.300 ÷ renda 8.000 = 53,8%');
  rep := rep || pg_temp.chk((ov -> 'budget_used_pct' ->> 'available')::boolean = false and (ov -> 'budget_used_pct' ->> 'value') is null, 'orçamento utilizado: sem orçamento = "Sem base para cálculo" (nada inventado)');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'reserve') = 0 and (ov -> 'reserve' ->> 'available')::boolean, 'reserva: conta marcada, ainda sem saldo = R$ 0,00');

  -- detalhamento reconcilia com cada cartão
  foreach k in array array['income_received','income_expected','expense_realized','expense_expected','overdue','due7','due30','invoices_next','fixed','variable'] loop
    d := public.pf_kpi_detail(k, v_cur, v_eom);
    v := case k when 'fixed' then pg_temp.kv(ov, 'fixed_expense') when 'variable' then pg_temp.kv(ov, 'variable_expense') when 'income_expected' then pg_temp.kv(ov, 'income_expected')
              when 'expense_realized' then pg_temp.kv(ov, 'expense_realized') when 'expense_expected' then pg_temp.kv(ov, 'expense_expected') else pg_temp.kv(ov, k) end;
    rep := rep || pg_temp.chk((d ->> 'total_cents')::bigint = v and (d ->> 'count')::int = jsonb_array_length(d -> 'rows'), 'detalhamento "' || k || '" soma o mesmo valor do cartão (' || coalesce(v::text, '?') || ')');
  end loop;

  -- ============ 2) custo de vida (próximos 12 meses)
  lc := public.pf_living_cost('next12');
  rep := rep || pg_temp.chk((lc ->> 'projected_total_cents')::bigint = 3561000, 'custo projetado 12 meses = 4.610 (mês atual) + 2.900 + 2.900 + 9 × 2.800 = R$ 35.610,00');
  rep := rep || pg_temp.chk((lc ->> 'realized_cents')::bigint = 411000 and (lc ->> 'committed_cents')::bigint = 2820000 and (lc ->> 'variable_cents')::bigint = 330000, 'separado: realizado 4.110 · compromissos 28.200 · variável 3.300 (soma = total)');
  rep := rep || pg_temp.chk((lc ->> 'monthly_average_cents')::bigint = 296750, 'média mensal equivalente = 35.610 ÷ 12 = R$ 2.967,50');
  rep := rep || pg_temp.chk(jsonb_array_length(lc -> 'months') = 12 and ((lc -> 'months' -> 1) ->> 'total_cents')::bigint = 290000 and ((lc -> 'months' -> 3) ->> 'total_cents')::bigint = 280000, 'mês 2 = aluguel 2.500 + energia 300 + parcela da TV 100; a partir do mês 4 (parcelas acabaram) = 2.800');
  rep := rep || pg_temp.chk(not (lc ->> 'incomplete')::boolean, 'projeção completa (há estimativa na recorrência variável)');
  -- aluguel e energia não são multiplicados por 12 às cegas: a série encerrada não projeta nada
  perform public.pf_series_action(s_en, 'pause', (v_cur + interval '1 month')::date);
  lc := public.pf_living_cost('next12');
  rep := rep || pg_temp.chk((lc ->> 'projected_total_cents')::bigint = 3561000 - 330000, 'pausar a energia a partir do mês seguinte remove os 11 meses de estimativa (pausas respeitadas)');
  perform public.pf_series_action(s_en, 'resume', (v_cur + interval '1 month')::date);
  -- sobra do orçamento (Moradia, mês seguinte)
  perform public.pf_budget_set((v_cur + interval '1 month')::date, cat_h, 400000);
  lc := public.pf_living_cost('next12');
  rep := rep || pg_temp.chk(((lc -> 'months' -> 1) ->> 'budget_topup_cents')::bigint = 120000 and (lc ->> 'projected_total_cents')::bigint = 3561000 + 120000, 'orçamento de Moradia 4.000 no mês seguinte: aluguel 2.500 + energia 300 já projetados → sobra 1.200 entra como variável');
  rep := rep || pg_temp.chk((lc ->> 'monthly_cash_need_cents')::bigint = (lc ->> 'monthly_average_cents')::bigint + (lc ->> 'destinations_monthly_cents')::bigint, 'necessidade de caixa = custo médio + destinações (aportes em metas)');
  perform public.pf_budget_set((v_cur + interval '1 month')::date, cat_h, null);
  -- ano-calendário usa as mesmas regras (janeiro até dezembro do ano atual)
  lc := public.pf_living_cost('calendar');
  rep := rep || pg_temp.chk(jsonb_array_length(lc -> 'months') = 12 and (lc ->> 'mode') = 'calendar', 'modo ano-calendário: 12 meses de janeiro a dezembro');
  -- orçamento do mês atual e % utilizado
  perform public.pf_budget_set(v_cur, cat_h, 500000);
  ov := public.pf_overview(v_cur, v_eom);
  rep := rep || pg_temp.chk((ov -> 'budget_used_pct' ->> 'value')::numeric = 80.2, 'orçamento utilizado = (aluguel 2.500 + energia 310 + compra no cartão 1.200, categorias de Moradia) 4.010 ÷ 5.000 = 80,2% → ' || coalesce(ov -> 'budget_used_pct' ->> 'value', '?'));

  -- ============ 3) cartão: limite não é dinheiro; fatura paga não duplica a despesa
  r := public.pf_cards_overview();
  rep := rep || pg_temp.chk(((r -> 'cards' -> 0) ->> 'used_cents')::bigint = 150000 and ((r -> 'cards' -> 0) ->> 'available_cents')::bigint = 350000, 'limite 5.000: usado 1.500 (faturas em aberto), disponível 3.500');
  select id into inv from public.pf_invoices where card_id = card order by due_date limit 1;
  perform public.pf_invoice_pay(inv, acc, 130000, v_cur, 's31-fatura');
  ov := public.pf_overview(v_cur, v_eom);
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'expense_realized') = 411000, 'pagar a fatura NÃO altera as despesas realizadas (R$ 4.110,00)');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'account_balance') = 100000 + 800000 - 250000 - 31000 - 130000, 'mas reduz o saldo da conta em R$ 1.300,00 (caixa)');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'invoices_next') = 20000, 'faturas em aberto passam a R$ 200,00');

  -- ============ 4) reserva e aportes não são despesa
  perform public.pf_transfer_create(acc, res, 100000, v_cur, 'reserve', null, null, 's31-reserva');
  ov := public.pf_overview(v_cur, v_eom);
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'reserve') = 100000 and pg_temp.kv(ov, 'expense_realized') = 411000, 'aporte de R$ 1.000,00 na reserva: reserva = 1.000,00 e as despesas não mudam');
  rep := rep || pg_temp.chk((ov -> 'reserve_coverage_months' ->> 'value')::numeric = round(100000.0 / ((public.pf_living_cost('next12')) ->> 'monthly_average_cents')::numeric, 1), 'cobertura = reserva ÷ custo mensal projetado');
  rep := rep || pg_temp.chk(pg_temp.kv(ov, 'account_balance') = 100000 + 800000 - 250000 - 31000 - 130000, 'o saldo total das contas não muda com a transferência interna');

  -- ============ 5) calendário reconcilia: agenda × KPIs (sem contar compra e fatura duas vezes)
  ag := public.pf_agenda(v_cur, v_eom);
  select coalesce(sum((i ->> 'cash_out')::bigint), 0) into v from jsonb_array_elements(ag -> 'items') i;
  rep := rep || pg_temp.chk(v = 50000, 'agenda do mês atual: saídas de caixa = dentista R$ 500,00 (a compra e a TV no cartão aparecem, mas sem saída)');
  select coalesce(sum((i ->> 'cash_out')::bigint), 0) into v from jsonb_array_elements(ag -> 'items') i where i ->> 'source' = 'entry' and (i ->> 'is_card')::boolean;
  rep := rep || pg_temp.chk(v = 0 and exists (select 1 from jsonb_array_elements(ag -> 'items') i where i ->> 'description' = 'Compra cartão S31'), 'compras no cartão aparecem no calendário SEM saída de caixa (a saída é a fatura)');
  ag := public.pf_agenda((v_cur + interval '1 month')::date, (v_cur + interval '2 months' - interval '1 day')::date);
  select coalesce(sum((i ->> 'cash_out')::bigint), 0) into v from jsonb_array_elements(ag -> 'items') i;
  select count(*) into n from jsonb_array_elements(ag -> 'items') i where i ->> 'source' = 'invoice';
  rep := rep || pg_temp.chk(n = 1 and v = 250000 + 30000, 'mês seguinte: a fatura paga aparece uma vez (saída 0) e as saídas são aluguel 2.500 + energia 300 (recorrências calculadas)');

  -- ============ 6) fluxo de caixa projetado
  cf := public.pf_cashflow(3);
  rep := rep || pg_temp.chk((cf ->> 'start_balance_cents')::bigint = pg_temp.kv(ov, 'account_balance'), 'fluxo de caixa parte do saldo atual das contas');
  rep := rep || pg_temp.chk(((cf -> 'months' -> 0) ->> 'balance_cents')::bigint = (cf ->> 'start_balance_cents')::bigint + ((cf -> 'months' -> 0) ->> 'inflow_cents')::bigint - ((cf -> 'months' -> 0) ->> 'outflow_cents')::bigint
                            and ((cf -> 'months' -> 0) ->> 'outflow_cents')::bigint = 750000 + 50000, 'mês atual: saídas = 7.500 vencidos + 500 dentista = 8.000');
  rep := rep || pg_temp.chk(((cf -> 'months' -> 1) ->> 'outflow_cents')::bigint = 250000 + 30000, 'mês seguinte: aluguel + energia estimada = R$ 2.800,00 (fatura já paga)');
  rep := rep || pg_temp.chk(((cf -> 'months' -> 2) ->> 'outflow_cents')::bigint = 250000 + 30000 + 10000, 'dois meses à frente: aluguel + energia + fatura com a 2ª parcela da TV = R$ 2.900,00 (a compra em si não é saída)');

  -- ============ 7) lembretes: uma vez por ocorrência
  perform public.pf_entry_create(jsonb_build_object('kind','expense','description','Boleto próximo S31','amount_cents',7000,'account_id',acc,'due_date',v_today + 2));
  rm := public.pf_reminders_due();
  select i ->> 'key' into key from jsonb_array_elements(rm -> 'reminders') i where i ->> 'description' = 'Boleto próximo S31';
  rep := rep || pg_temp.chk(key is not null, 'vencimento em 2 dias aparece nos lembretes (antecedência padrão de 3 dias)');
  perform public.pf_reminder_ack(key); perform public.pf_reminder_ack(key);
  rm := public.pf_reminders_due();
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(rm -> 'reminders') i where i ->> 'description' = 'Boleto próximo S31'), 'depois de marcado como visto, o mesmo lembrete não volta');
  perform public.pf_settings_save(0, false, 6);
  rm := public.pf_reminders_due();
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(rm -> 'reminders') i where (i ->> 'days_left')::int > 0), 'antecedência configurável (0 dia: só o que vence hoje)');

  -- ============ 8) outro usuário: sem base de cálculo (nada inventado) e projeção incompleta
  perform pg_temp.as_user(u_b);
  perform public.pf_bootstrap();
  acc_b := public.pf_account_save(null, 'Conta B S31', 'checking', 0, date '2026-01-01', false);
  select id into cat_b from public.pf_categories where owner_user_id = u_b and name = 'Moradia' and parent_id is null;
  ov := public.pf_overview(v_cur, v_eom);
  rep := rep || pg_temp.chk((ov -> 'income_commitment_pct' ->> 'available')::boolean = false and (ov -> 'income_commitment_pct' ->> 'value') is null and (ov -> 'reserve_coverage_months' ->> 'value') is null, 'sem renda e sem reserva: comprometimento e cobertura = "Sem base para cálculo"');
  lc := public.pf_living_cost('next12');
  rep := rep || pg_temp.chk((lc ->> 'incomplete')::boolean and (lc ->> 'projected_total_cents')::bigint = 0, 'sem orçamento nem estimativas: projeção marcada como INCOMPLETA (e zero não é apresentado como custo)');
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Água S31','category_id',cat_b,'account_id',acc_b,'nature','variable','repetition','recurring','recurrence', jsonb_build_object('frequency','monthly','start_date',(v_cur - interval '2 months')::date,'due_day',1)));
  s_water := (r ->> 'id')::uuid;
  lc := public.pf_living_cost('next12');
  rep := rep || pg_temp.chk((lc ->> 'incomplete')::boolean and (lc -> 'incomplete_reasons' ->> 0) like '%sem estimativa e sem histórico%', 'recorrência variável sem estimativa nem histórico: avisa que ainda não entra na projeção');
  perform public.pf_entry_settle(jsonb_build_object('series_id', s_water, 'occurrence_date', (v_cur - interval '2 months')::date), 10000, (v_cur - interval '2 months')::date, acc_b, true);
  perform public.pf_entry_settle(jsonb_build_object('series_id', s_water, 'occurrence_date', (v_cur - interval '1 month')::date), 12000, (v_cur - interval '1 month')::date, acc_b, true);
  lc := public.pf_living_cost('next12');
  rep := rep || pg_temp.chk(not (lc ->> 'incomplete')::boolean and ((lc -> 'suggestions' -> 0) ->> 'suggested_cents')::bigint = 11000 and ((lc -> 'suggestions' -> 0) ->> 'based_on')::int = 2
                            and ((lc -> 'months' -> 0) ->> 'variable_cents')::bigint = 11000, 'com histórico: sugere a média (R$ 110,00 sobre 2 meses), mostra a fonte e passa a projetar');

  -- ============ 9) isolamento dos relatórios
  perform pg_temp.as_user(u_a);
  rep := rep || pg_temp.chk(pg_temp.kv(public.pf_overview(v_cur, v_eom), 'income_received') = 800000, 'os totais de A não incluem nada de B');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.payables where description like '%S31%') = 0 and (select count(*) from public.receivables) >= 0, 'nada vaza para as tabelas do financeiro empresarial (contas a pagar)');

  raise exception E'RELATORIO_S31_PF_INDICADORES (transação desfeita):%', rep;
end $$;
