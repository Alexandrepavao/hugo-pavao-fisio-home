-- Teste do detalhamento de cartões (dashboard_card_detail, migration 041): total reconcilia com o indicador
-- (inclusive além do limite de 20 itens da lista — bug real encontrado e corrigido nesta rodada), indisponível
-- com motivo real, e bloqueio de papel sem permissão (eventos_falhos exige manager). Transação desfeita.
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_um uuid := gen_random_uuid();
  pa uuid; prod uuid; s uuid; r uuid;
  d jsonb; n int; ok boolean; rep text := ''; v_before_total int; v_before_value numeric; v_before_receipts numeric;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m-cd@t.local'),(u_sales,'authenticated','authenticated','s-cd@t.local'),(u_um,'authenticated','authenticated','u-cd@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_sales, v_org),(u_um, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_ua),(v_org, u_um, 'unit_manager', v_ua);
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Serviço card-detail (teste)', 10000) returning id into prod;

  -- Linha de base ANTES de inserir os dados do teste — asserções por delta, não valor absoluto: a unidade já tem
  -- dados de outras execuções/sessões de QA e comparar por valor fixo já quebrou um teste antes (ver 07-finance-behaviors).
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  d := public.dashboard_card_detail('new_patients', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  v_before_total := (d ->> 'total_items')::int; v_before_value := (d ->> 'value')::numeric;
  d := public.dashboard_card_detail('receipts', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  v_before_receipts := (d ->> 'value')::numeric;
  reset role;

  -- 25 pessoas "novo paciente" no período: total_items deve refletir as +25, não travar em 20 (o bug corrigido).
  -- Inserido antes da troca de papel (mesma convenção de 008_dashboard.sql) — o teste é do detalhamento, não do insert de pessoa.
  for n in 1..25 loop
    insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente CardDetail ' || n) returning id into pa;
    insert into public.person_kinds (person_id, kind) values (pa, 'patient');
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  d := public.dashboard_card_detail('new_patients', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  select count(*) into n from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = 'patient'
    where p.unit_id = v_ua and p.created_at >= now() - interval '1 hour' and p.created_at < now() + interval '1 hour';
  rep := rep || format(E'\n[%s] total_items do detalhamento sobe exatamente +25 e bate com uma contagem independente na mesma janela (total=%s valor=%s contagem_independente=%s)',
    case when (d ->> 'total_items')::int = v_before_total + 25 and (d ->> 'value')::numeric = v_before_value + 25 and (d ->> 'value')::numeric = n::numeric then 'OK' else 'FALHA' end,
    d ->> 'total_items', d ->> 'value', n);
  rep := rep || format(E'\n[%s] lista de registros vem truncada em 20 mesmo com total maior (%s itens)', case when jsonb_array_length(d -> 'items') = 20 then 'OK' else 'FALHA' end, jsonb_array_length(d -> 'items'));

  -- venda + pagamento: recebimentos do detalhamento sobem exatamente o valor pago
  s := public.sale_create(pa, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod)), 0, 1, current_date);
  perform public.sale_confirm(s);
  select id into r from public.receivables where sale_id = s;
  perform public.payment_record(r, 10000, now(), 'pix', (select id from public.financial_accounts where org_id = v_org limit 1), 'card-detail-1');
  d := public.dashboard_card_detail('receipts', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  rep := rep || format(E'\n[%s] recebimentos do detalhamento sobem exatamente 10000 centavos (%s -> %s)', case when (d ->> 'value')::numeric = v_before_receipts + 10000 then 'OK' else 'FALHA' end, v_before_receipts, d ->> 'value');

  -- indisponível com motivo real (win_rate sem oportunidades fechadas no período)
  d := public.dashboard_card_detail('win_rate', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  rep := rep || format(E'\n[%s] win_rate indisponível traz o motivo real, não um valor fictício (available=%s, basis=%s)',
    case when not (d ->> 'available')::boolean and (d -> 'value') = 'null'::jsonb and length(d ->> 'basis') > 10 then 'OK' else 'FALHA' end, d ->> 'available', d ->> 'basis');

  -- "situação atual" (snapshot) corretamente marcada para active_packages
  d := public.dashboard_card_detail('active_packages', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  rep := rep || format(E'\n[%s] active_packages é marcado como situação atual (is_current_snapshot=%s)', case when (d ->> 'is_current_snapshot')::boolean then 'OK' else 'FALHA' end, d ->> 'is_current_snapshot');
  reset role;

  -- comercial (sales) não acessa NENHUM detalhamento (mesma regra de dashboard_metrics/alerts: sales fica fora do painel consolidado)
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.dashboard_card_detail('new_patients', now() - interval '1 hour', now() + interval '1 hour', v_ua); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial não acessa o detalhamento do painel consolidado (mesma regra do dashboard_metrics)', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- gestor de unidade acessa cartões comuns da sua unidade, mas eventos_falhos exige manager especificamente
  perform set_config('request.jwt.claims', json_build_object('sub', u_um, 'role','authenticated')::text, true);
  set local role authenticated;
  d := public.dashboard_card_detail('new_patients', now() - interval '1 hour', now() + interval '1 hour', v_ua);
  rep := rep || format(E'\n[%s] gestor de unidade acessa detalhamento de um cartão comum na sua unidade (%s)', case when (d ->> 'value')::numeric = v_before_value + 25 then 'OK' else 'FALHA' end, d ->> 'value');
  ok := false; begin perform public.dashboard_card_detail('eventos_falhos', now() - interval '1 hour', now() + interval '1 hour', v_ua); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de unidade não acessa detalhamento de automações com falha (exige manager)', case when ok then 'OK' else 'FALHA' end);
  -- tipo desconhecido não devolve dado silencioso — erro explícito
  ok := false; begin perform public.dashboard_card_detail('tipo_inexistente', now(), now(), v_ua); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] tipo de cartão desconhecido gera erro explícito, nunca um resultado vazio silencioso', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_DASHBOARD_CARD_DETAIL (transação desfeita):%', rep;
end $$;
