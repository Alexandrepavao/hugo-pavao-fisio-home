-- HP Group Hub — 020 Recorrência (MRR/ARR), DRE honesta, envelhecimento de vencidos, eficiência e distribuição geográfica
-- Reaproveita private.metric() (011) para o padrão {value, available, basis} — nunca zero fictício.
-- MRR/ARR usam o único sinal real de recorrência já existente: products.recurrence='monthly' + receivables.competence_month
-- (o mesmo par de colunas que já alimenta public.subscription_forecast). Não há motor de cobrança recorrente automática
-- nesta versão: "ativo no mês M" = existe um recebível de competência M para aquele par (pessoa, produto) numa venda
-- confirmada e não cancelado — é exatamente a mesma definição de "assinante" implícita no forecast já revisado.

-- ---------------------------------------------------------------- localização (pacientes, parceiros e alunos são todos public.people)
alter table public.people add column city text;
alter table public.people add column state_uf text check (state_uf is null or state_uf ~ '^[A-Z]{2}$');
alter table public.people add column country text not null default 'BR';
create index people_geo_idx on public.people (state_uf, city) where state_uf is not null;

-- ---------------------------------------------------------------- MRR/ARR com ponte de movimentação (fecha matematicamente por construção)
create or replace function private.mrr_base(p_month date) returns table (person_id uuid, product_id uuid, amount_cents bigint, unit_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.person_id, r.product_id) r.person_id, r.product_id, r.amount_cents, r.unit_id
  from public.receivables r
  join public.products pr on pr.id = r.product_id and pr.recurrence = 'monthly'
  join public.sales s on s.id = r.sale_id and s.status = 'confirmed'
  where r.competence_month = date_trunc('month', p_month)::date and r.status <> 'cancelled'
  order by r.person_id, r.product_id, r.due_date desc
$$;

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
  -- Duas CTEs (mês anterior e mês atual) reaproveitadas em todas as contas abaixo — sem tabela temporária
  -- (evita DDL dentro de função `stable`; private.mrr_base() já é barata, filtrada por índice de competência).
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce((select sum(amount_cents) from t_prev), 0), coalesce((select sum(amount_cents) from t_curr), 0),
         (select count(distinct person_id) from t_prev), (select count(distinct person_id) from t_curr)
    into v_mrr_ini, v_mrr_fim, v_clientes_ini, v_clientes_fim;

  -- novo: nunca teve recebível recorrente antes do mês anterior para este par (pessoa, produto)
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(c.amount_cents), 0) into v_novo from t_curr c
    where not exists (select 1 from t_prev p where p.person_id = c.person_id and p.product_id = c.product_id)
      and not exists (select 1 from public.receivables r join public.products pr on pr.id = r.product_id and pr.recurrence = 'monthly'
                        join public.sales s on s.id = r.sale_id and s.status = 'confirmed'
                       where r.person_id = c.person_id and r.product_id = c.product_id and r.status <> 'cancelled' and r.competence_month < v_prev);
  -- reativação: estava ausente no mês anterior, mas já teve recebível recorrente em algum mês anterior a esse
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(c.amount_cents), 0) into v_reativacao from t_curr c
    where not exists (select 1 from t_prev p where p.person_id = c.person_id and p.product_id = c.product_id)
      and exists (select 1 from public.receivables r join public.products pr on pr.id = r.product_id and pr.recurrence = 'monthly'
                    join public.sales s on s.id = r.sale_id and s.status = 'confirmed'
                   where r.person_id = c.person_id and r.product_id = c.product_id and r.status <> 'cancelled' and r.competence_month < v_prev);
  -- expansão / contração: par presente nos dois meses, valor mudou
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(greatest(c.amount_cents - p.amount_cents, 0)), 0), coalesce(sum(greatest(p.amount_cents - c.amount_cents, 0)), 0)
    into v_expansao, v_contracao
    from t_curr c join t_prev p on p.person_id = c.person_id and p.product_id = c.product_id;
  -- cancelamento: presente antes, ausente agora
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select coalesce(sum(p.amount_cents), 0) into v_cancelamento from t_prev p
    where not exists (select 1 from t_curr c where c.person_id = p.person_id and c.product_id = p.product_id);
  with t_prev as (select * from private.mrr_base(v_prev) where unit_id = any (u)),
       t_curr as (select * from private.mrr_base(v_month) where unit_id = any (u))
  select v_clientes_ini - count(distinct p.person_id) into v_clientes_churn from t_prev p join t_curr c on c.person_id = p.person_id;

  return jsonb_build_object(
    'month', v_month, 'previous_month', v_prev,
    'mrr_cents', private.metric(v_mrr_fim, true, 'soma dos recebíveis de competência do mês para produtos com recorrência mensal, venda confirmada e recebível não cancelado (compromisso contratado, não caixa recebido)'),
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

-- histórico de MRR/ARR para o gráfico (últimos N meses, sem recalcular a ponte para cada um — só o total do mês)
create or replace function public.mrr_history(p_months int default 12, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); v_from date := date_trunc('month', current_date - (p_months - 1) * interval '1 month')::date;
begin
  return coalesce((select jsonb_agg(jsonb_build_object('month', m, 'mrr_cents', coalesce(t.total, 0)) order by m)
    from generate_series(v_from, date_trunc('month', current_date)::date, interval '1 month') m
    left join lateral (select sum(amount_cents) as total from private.mrr_base(m::date) where unit_id = any (u)) t on true), '[]');
end $$;

-- ---------------------------------------------------------------- DRE / rentabilidade (honesta: sem custo direto cadastrado, margem fica indisponível)
create or replace function public.dre_report(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_receita bigint; v_estornos bigint; v_despesas bigint; v_by_cat jsonb; v_any_exp boolean;
begin
  select coalesce(sum(case py.kind when 'payment' then py.amount_cents else 0 end), 0),
         coalesce(sum(case py.kind when 'refund' then py.amount_cents else 0 end), 0)
    into v_receita, v_estornos from public.payments py where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to;
  select coalesce(sum(amount_cents), 0) into v_despesas from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to;
  v_any_exp := exists (select 1 from public.payables where unit_id = any (u));
  select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(fc.name, 'Sem categoria'), 'amount_cents', x.total) order by x.total desc), '[]') into v_by_cat
    from (select category_id, sum(amount_cents) total from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to group by 1) x
    left join public.finance_categories fc on fc.id = x.category_id;
  return jsonb_build_object(
    'receita_bruta_cents', private.metric(v_receita, true, 'soma dos recebimentos líquidos de estorno no período (regime de caixa)'),
    'estornos_cents', private.metric(v_estornos, true, 'soma dos estornos registrados no período'),
    'receita_liquida_cents', private.metric(v_receita - v_estornos, true, 'recebimentos − estornos'),
    'despesas_operacionais_cents', private.metric(v_despesas, v_any_exp, 'contas pagas no período, por categoria'),
    'despesas_por_categoria', v_by_cat,
    'resultado_caixa_cents', private.metric(v_receita - v_estornos - v_despesas, true, 'receita líquida − despesas pagas (regime de caixa — NÃO é lucro contábil)'),
    'deducoes_cents', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: não há retenção de impostos cadastrada por venda'),
    'custos_diretos_cents', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: contas a pagar não são vinculadas a um produto/serviço específico nesta versão'),
    'margem_contribuicao_cents', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: depende de custo direto por produto/serviço, não cadastrado'),
    'resultado_operacional_cents', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: depende de custo direto por produto/serviço, não cadastrado')
  );
end $$;

-- rentabilidade por produto e unidade: só a parte com base real (receita reconhecida), nunca "margem" sem custo
create or replace function public.revenue_by_unit(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('unit_id', un.id, 'unit_name', un.name, 'received_cents', coalesce(x.total, 0)) order by coalesce(x.total, 0) desc)
    from public.units un left join (select unit_id, sum(case kind when 'payment' then amount_cents else -amount_cents end) total from public.payments where unit_id = any (u) and paid_at >= p_from and paid_at < p_to group by 1) x on x.unit_id = un.id
    where un.id = any (u)), '[]');
end $$;

-- ---------------------------------------------------------------- envelhecimento de vencidos (1–30, 31–60, 61–90, 90+)
create or replace function public.overdue_aging(p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); a bigint; b bigint; c bigint; d bigint;
begin
  select coalesce(sum(r.amount_cents - private.receivable_net(r.id)) filter (where current_date - r.due_date between 1 and 30), 0),
         coalesce(sum(r.amount_cents - private.receivable_net(r.id)) filter (where current_date - r.due_date between 31 and 60), 0),
         coalesce(sum(r.amount_cents - private.receivable_net(r.id)) filter (where current_date - r.due_date between 61 and 90), 0),
         coalesce(sum(r.amount_cents - private.receivable_net(r.id)) filter (where current_date - r.due_date > 90), 0)
    into a, b, c, d from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date;
  return jsonb_build_object('d1_30_cents', a, 'd31_60_cents', b, 'd61_90_cents', c, 'd90_plus_cents', d);
end $$;

-- ---------------------------------------------------------------- eficiência do negócio (só o que tem base real; CAC/LTV ficam indisponíveis sem dado de mídia)
create or replace function public.efficiency_report(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_recognized bigint; v_paying_patients bigint; v_attended bigint; v_repeat_pct numeric; v_total_buyers bigint; v_repeat_buyers bigint;
  v_top_products jsonb; v_top_clients_share numeric;
begin
  select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0) into v_recognized from public.payments where unit_id = any (u) and paid_at >= p_from and paid_at < p_to;
  select count(distinct person_id) into v_paying_patients from public.sales where unit_id = any (u) and status = 'confirmed' and sold_at >= p_from and sold_at < p_to;
  select count(*) into v_attended from public.appointments where unit_id = any (u) and status = 'attended' and lower(period) >= p_from and lower(period) < p_to;
  select count(distinct person_id) into v_total_buyers from public.sales where unit_id = any (u) and status = 'confirmed';
  select count(*) into v_repeat_buyers from (select person_id from public.sales where unit_id = any (u) and status = 'confirmed' group by person_id having count(*) > 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('product_name', name, 'received_cents', total, 'share_pct', round(total * 100.0 / nullif(sum(total) over (), 0), 1)) order by total desc), '[]')
    into v_top_products from (
      select p.name, sum(case py.kind when 'payment' then py.amount_cents else -py.amount_cents end) total
      from public.payments py join public.receivables r on r.id = py.receivable_id join public.products p on p.id = r.product_id
      where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to group by p.name) x limit 10;
  return jsonb_build_object(
    'receita_por_paciente_pagante_cents', private.metric(case when v_paying_patients > 0 then round(v_recognized::numeric / v_paying_patients, 0) end, v_paying_patients > 0, 'recebido no período ÷ pacientes com venda confirmada no período'),
    'receita_por_sessao_cents', private.metric(case when v_attended > 0 then round(v_recognized::numeric / v_attended, 0) end, v_attended > 0, 'recebido no período ÷ atendimentos realizados no período'),
    'taxa_recompra_pct', private.metric(case when v_total_buyers > 0 then round(v_repeat_buyers * 100.0 / v_total_buyers, 1) end, v_total_buyers > 0, 'pessoas com mais de uma venda confirmada (histórico) ÷ total de compradores (%)'),
    'concentracao_por_produto', v_top_products,
    'cac_cents', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: não há dados de investimento em mídia/aquisição no sistema'),
    'ltv_cents', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: depende de CAC e de histórico de retenção mais longo que o disponível'),
    'cac_payback_months', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: depende do CAC')
  );
end $$;

-- ---------------------------------------------------------------- distribuição geográfica (pacientes, parceiros, alunos — todos public.people, deduplicados por pessoa dentro do segmento)
create or replace function public.geo_distribution(p_kind public.person_kind, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_total bigint; v_no_loc bigint; v_by_state jsonb; v_by_city jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := private.dash_units(p_unit);
  select count(*) into v_total from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
    where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u));
  select count(*) into v_no_loc from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
    where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u)) and p.state_uf is null;
  select coalesce(jsonb_agg(jsonb_build_object('uf', state_uf, 'count', n, 'pct', round(n * 100.0 / nullif(v_total, 0), 1)) order by n desc), '[]') into v_by_state
    from (select state_uf, count(*) n from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
            where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u)) and p.state_uf is not null group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'uf', state_uf, 'count', n) order by n desc), '[]') into v_by_city
    from (select city, state_uf, count(*) n from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
            where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u)) and p.city is not null group by 1, 2 order by 3 desc limit 20) x;
  return jsonb_build_object('total', v_total, 'sem_localizacao', v_no_loc, 'by_state', v_by_state, 'by_city', v_by_city);
end $$;

grant execute on function public.mrr_report(date, uuid), public.mrr_history(int, uuid), public.dre_report(timestamptz, timestamptz, uuid),
  public.revenue_by_unit(timestamptz, timestamptz, uuid), public.overdue_aging(uuid), public.efficiency_report(timestamptz, timestamptz, uuid),
  public.geo_distribution(public.person_kind, uuid) to authenticated;
