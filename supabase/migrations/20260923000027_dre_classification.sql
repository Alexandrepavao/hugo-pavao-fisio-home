-- HP Group Hub — 027 DRE utilizável: classificação de categoria + custo direto opcionalmente atribuído a um
-- produto. Reaproveita finance_categories/cost_centers/payables já existentes — não duplica estrutura.
-- Regra: ausência de custo POR PRODUTO pode deixar a margem DAQUELE produto indisponível, mas não trava os
-- totais consolidados (deduções/custo direto/despesa operacional/resultado) assim que houver QUALQUER
-- lançamento classificado no período. Lançamento sem categoria ou com categoria sem classificação DRE fica de
-- fora dos três baldes e aparece separado como "sem classificação" — nunca vira despesa operacional por padrão
-- (isso inventaria dado) nem é ignorado silenciosamente (isso esconderia cobertura parcial).

alter table public.finance_categories add column dre_classification text check (dre_classification in ('deducao','custo_direto','despesa_operacional'));
alter table public.payables add column product_id uuid references public.products(id) on delete set null;   -- opcional: só quando o custo é de fato atribuível a um produto/serviço

-- Reconhecimento de receita: mesma regra já usada em results_by_product (pacote = sessões realizadas ×
-- valor/sessão; demais = recebido) — sem duplicar a lógica, a DRE soma o que essa função já calcula por produto.
create or replace function public.dre_report(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_receita bigint; v_estornos bigint; v_despesas bigint; v_any_exp boolean;
  v_deducao bigint; v_custo_direto bigint; v_despesa_op bigint; v_sem_classificar bigint;
  v_total_payables bigint; v_classificados bigint; v_cobertura_pct numeric;
  v_by_cat jsonb; v_sem_classificar_n int; v_classificacao_configurada boolean;
begin
  -- "Configurada" = existe ao menos uma categoria com classificação DRE definida (Configurações → Categorias),
  -- independente de ter caído algum lançamento nela NESTE período — um valor 0 real é diferente de indisponível.
  v_classificacao_configurada := exists (select 1 from public.finance_categories where org_id = private.current_org() and dre_classification is not null);
  select coalesce(sum(case py.kind when 'payment' then py.amount_cents else 0 end), 0),
         coalesce(sum(case py.kind when 'refund' then py.amount_cents else 0 end), 0)
    into v_receita, v_estornos from public.payments py where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to;

  select coalesce(sum(amount_cents), 0) into v_despesas from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to;
  v_any_exp := exists (select 1 from public.payables where unit_id = any (u));

  select coalesce(sum(b.amount_cents) filter (where fc.dre_classification = 'deducao'), 0),
         coalesce(sum(b.amount_cents) filter (where fc.dre_classification = 'custo_direto'), 0),
         coalesce(sum(b.amount_cents) filter (where fc.dre_classification = 'despesa_operacional'), 0),
         coalesce(sum(b.amount_cents) filter (where fc.dre_classification is null), 0),
         count(*) filter (where fc.dre_classification is null),
         coalesce(sum(b.amount_cents), 0),
         coalesce(sum(b.amount_cents) filter (where fc.dre_classification is not null), 0)
    into v_deducao, v_custo_direto, v_despesa_op, v_sem_classificar, v_sem_classificar_n, v_total_payables, v_classificados
    from public.payables b left join public.finance_categories fc on fc.id = b.category_id
    where b.unit_id = any (u) and b.status = 'paid' and b.paid_at >= p_from and b.paid_at < p_to;
  v_cobertura_pct := case when v_total_payables > 0 then round(v_classificados * 100.0 / v_total_payables, 1) end;

  select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(fc.name, 'Sem categoria'), 'classification', fc.dre_classification, 'amount_cents', x.total) order by x.total desc), '[]') into v_by_cat
    from (select category_id, sum(amount_cents) total from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to group by 1) x
    left join public.finance_categories fc on fc.id = x.category_id;

  return jsonb_build_object(
    'receita_caixa_cents', private.metric(v_receita - v_estornos, true, 'recebimentos líquidos de estorno no período (regime de caixa)'),
    'receita_reconhecida_cents', private.metric((select coalesce(sum(recognized_cents), 0) from public.results_by_product(p_from, p_to, p_unit)), true, 'mesma regra de results_by_product: pacote = sessões realizadas × valor/sessão (competência real de serviço prestado); demais produtos ainda usam o recebimento como proxy de reconhecimento (regra gerencial proposta herdada — equivale ao caixa para esses produtos até haver uma regra de competência própria por tipo de produto)'),
    'estornos_cents', private.metric(v_estornos, true, 'soma dos estornos registrados no período'),
    'despesas_operacionais_totais_cents', private.metric(v_despesas, v_any_exp, 'todas as contas pagas no período (com e sem classificação DRE) — ver "despesas_por_categoria" para o detalhe'),
    'despesas_por_categoria', v_by_cat,
    'resultado_caixa_cents', private.metric(v_receita - v_estornos - v_despesas, true, 'receita de caixa − todas as despesas pagas (regime de caixa — NÃO é lucro contábil)'),

    'deducoes_cents', private.metric(v_deducao, v_classificacao_configurada, 'contas pagas no período com categoria classificada como "dedução" (ex.: impostos sobre a venda) — soma consolidada'),
    'custos_diretos_cents', private.metric(v_custo_direto, v_classificacao_configurada, 'contas pagas com categoria classificada como "custo direto" no período — consolidado; margem POR PRODUTO específico continua indisponível sem o custo daquele produto atribuído (campo opcional em Contas a pagar, ver margin_by_product)'),
    'despesas_operacionais_cents', private.metric(v_despesa_op, v_classificacao_configurada, 'contas pagas com categoria classificada como "despesa operacional" no período'),
    'sem_classificacao_cents', jsonb_build_object('value', v_sem_classificar, 'count', v_sem_classificar_n, 'basis', 'contas pagas no período sem categoria ou com categoria ainda não classificada na DRE (Configurações → Categorias) — ficam de fora dos totais abaixo, nunca viram despesa operacional por padrão'),
    'cobertura_classificacao_pct', private.metric(v_cobertura_pct, v_total_payables > 0, 'valor classificado ÷ valor total de contas pagas no período (%) — indica o quanto o resultado abaixo é confiável'),
    'margem_contribuicao_cents', private.metric((select coalesce(sum(recognized_cents), 0) from public.results_by_product(p_from, p_to, p_unit)) - v_custo_direto, v_classificacao_configurada, 'receita reconhecida − custos diretos classificados no período (consolidado; não substitui a margem por produto, que precisa do custo atribuído a cada produto)'),
    'resultado_operacional_cents', private.metric((select coalesce(sum(recognized_cents), 0) from public.results_by_product(p_from, p_to, p_unit)) - v_deducao - v_custo_direto - v_despesa_op, v_classificacao_configurada, 'receita reconhecida − deduções − custos diretos − despesas operacionais (só considera o que está classificado; ver cobertura de classificação)')
  );
end $$;

-- margem por produto: só quando o custo direto DAQUELE produto foi de fato lançado (product_id na conta a pagar)
create or replace function public.margin_by_product(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', r.product_id, 'product_name', r.product_name, 'recognized_cents', r.recognized_cents,
      'direct_cost_cents', coalesce(c.total, 0), 'margin_cents', case when c.total is not null then r.recognized_cents - c.total end,
      'available', c.total is not null) order by r.recognized_cents desc)
    from public.results_by_product(p_from, p_to, p_unit) r
    left join (select product_id, sum(amount_cents) total from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to and product_id is not null group by 1) c on c.product_id = r.product_id
    where r.recognized_cents <> 0 or c.total is not null), '[]');
end $$;

grant execute on function public.margin_by_product(timestamptz, timestamptz, uuid) to authenticated;
