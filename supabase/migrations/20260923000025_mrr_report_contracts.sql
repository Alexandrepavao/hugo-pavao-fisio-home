-- HP Group Hub — 025 mrr_report() agora lê de private.mrr_base() (migration 024, base em recurring_contracts),
-- mantendo a mesma assinatura e o mesmo formato de retorno do front (nada muda em src/pages/admin/finance/Recurrence.tsx).
-- A ponte passa a ser identificada por contract_id (mais precisa que o par pessoa+produto usado antes: dois
-- contratos do mesmo produto para a mesma pessoa, se um dia existirem, não se confundem mais).
-- mrr_history() não precisa mudar — já soma o que private.mrr_base() devolver, seja qual for a fonte.
create or replace function public.mrr_report(p_month date default current_date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_month date := date_trunc('month', p_month)::date;
  v_prev date := (v_month - interval '1 month')::date;
  v_mrr_ini bigint; v_mrr_fim bigint;
  v_novo bigint; v_expansao bigint; v_reativacao bigint; v_contracao bigint; v_cancelamento bigint;
  v_clientes_ini bigint; v_clientes_fim bigint; v_clientes_churn bigint;
begin
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce((select sum(amount_cents) from t_prev), 0), coalesce((select sum(amount_cents) from t_curr), 0),
         (select count(distinct person_id) from t_prev), (select count(distinct person_id) from t_curr)
    into v_mrr_ini, v_mrr_fim, v_clientes_ini, v_clientes_fim;

  -- novo: contrato presente agora, ausente no mês anterior, e nunca teve estado ativo antes do início do mês anterior
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(c.amount_cents), 0) into v_novo from t_curr c
    where not exists (select 1 from t_prev p where p.contract_id = c.contract_id)
      and not private.contract_ever_active_before(c.contract_id, v_prev);

  -- reativação: ausente no mês anterior, presente agora, mas já esteve ativo antes disso (churnou e voltou)
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(c.amount_cents), 0) into v_reativacao from t_curr c
    where not exists (select 1 from t_prev p where p.contract_id = c.contract_id)
      and private.contract_ever_active_before(c.contract_id, v_prev);

  -- expansão / contração: mesmo contrato nos dois meses, valor mudou
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(greatest(c.amount_cents - p.amount_cents, 0)), 0), coalesce(sum(greatest(p.amount_cents - c.amount_cents, 0)), 0)
    into v_expansao, v_contracao
    from t_curr c join t_prev p on p.contract_id = c.contract_id;

  -- cancelamento (do ponto de vista do MRR): presente no mês anterior, ausente agora — cobre tanto "cancel" quanto "pause"
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(p.amount_cents), 0) into v_cancelamento from t_prev p
    where not exists (select 1 from t_curr c where c.contract_id = p.contract_id);

  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select v_clientes_ini - count(distinct p.person_id) into v_clientes_churn from t_prev p join t_curr c on c.person_id = p.person_id;

  return jsonb_build_object(
    'month', v_month, 'previous_month', v_prev,
    'mrr_cents', private.metric(v_mrr_fim, true, 'soma dos contratos recorrentes ativos no fim do mês (compromisso contratual, com vigência por data efetiva — nunca conta de pagamento nem parcela de venda avulsa)'),
    'arr_cents', private.metric(v_mrr_fim::numeric * 12, true, 'MRR do mês × 12 (receita recorrente anualizada — não é o recebido nos últimos 12 meses)'),
    'bridge', jsonb_build_object(
      'mrr_inicial_cents', v_mrr_ini, 'novo_cents', v_novo, 'expansao_cents', v_expansao, 'reativacao_cents', v_reativacao,
      'contracao_cents', -v_contracao, 'cancelamento_cents', -v_cancelamento, 'mrr_final_cents', v_mrr_fim,
      'fecha', (v_mrr_ini + v_novo + v_expansao + v_reativacao - v_contracao - v_cancelamento) = v_mrr_fim),
    'churn_clientes_pct', private.metric(case when v_clientes_ini > 0 then round(v_clientes_churn * 100.0 / v_clientes_ini, 1) end, v_clientes_ini > 0, 'clientes recorrentes do mês anterior que não seguem ativos ÷ clientes recorrentes do mês anterior (%)'),
    'churn_receita_pct', private.metric(case when v_mrr_ini > 0 then round((v_contracao + v_cancelamento) * 100.0 / v_mrr_ini, 1) end, v_mrr_ini > 0, '(contração + cancelamento) ÷ MRR inicial (%)'),
    'retencao_bruta_pct', private.metric(case when v_mrr_ini > 0 then round((v_mrr_ini - v_contracao - v_cancelamento) * 100.0 / v_mrr_ini, 1) end, v_mrr_ini > 0, '(MRR inicial − contração − cancelamento) ÷ MRR inicial, sem contar expansão (%)'),
    'retencao_liquida_pct', private.metric(case when v_mrr_ini > 0 then round((v_mrr_ini - v_contracao - v_cancelamento + v_expansao) * 100.0 / v_mrr_ini, 1) end, v_mrr_ini > 0, '(MRR inicial − contração − cancelamento + expansão) ÷ MRR inicial (%)'),
    'receita_media_cliente_cents', private.metric(case when v_clientes_fim > 0 then round(v_mrr_fim::numeric / v_clientes_fim, 0) end, v_clientes_fim > 0, 'MRR final ÷ clientes recorrentes ativos no mês'),
    'clientes_recorrentes', v_clientes_fim
  );
end $$;
