-- HP Group Hub — 060 Linhas de negócio em Recorrência (MRR/ARR), Relatórios de eficiência e Conciliação bancária.
-- ADITIVA e depende da 057 (products.business_line, split_sale_amount, split_payable). Nenhuma função existente é alterada:
-- mrr_report, mrr_history, efficiency_report, bank_* continuam iguais; as funções novas se reconciliam com elas.
--   • Recorrência: a linha do contrato é a do PRODUTO do contrato (contrato sem produto = "Não classificado"). Um contrato tem um só produto,
--     então não há divisão. A ponte (novo/expansão/reativação/contração/cancelamento) é calculada por linha e conferida contra mrr_report.
--   • Eficiência: receita líquida recebida é atribuída pela mesma divisão exata de finance_by_line; sessões realizadas pela linha do produto do
--     pacote da sessão (sessão sem pacote = "Não classificado"); pessoas podem aparecer nas duas linhas (por isso a soma de pessoas NÃO é conferida).
--   • Conciliação: o extrato importado (bank_statement_lines) NUNCA é alterado pela linha de negócio. A alocação é uma camada separada:
--       - movimento conciliado → a linha deriva do lançamento conciliado (venda ou conta a pagar), sem alocação manual (não duplica);
--       - movimento pendente/ignorado → alocação manual opcional em pontos-base (bank_line_allocations); sem ela fica "Não classificado".

-- ---------------------------------------------------------------- alocação manual de movimento bancário (camada separada do extrato)
create table public.bank_line_allocations (
  statement_line_id uuid not null references public.bank_statement_lines(id) on delete cascade,
  line text not null check (line in ('physio','academy','shared')),
  basis_points int not null check (basis_points between 1 and 10000),
  allocated_by uuid references auth.users(id) on delete set null,
  allocated_at timestamptz not null default now(),
  primary key (statement_line_id, line)
);
alter table public.bank_line_allocations enable row level security;
grant select on public.bank_line_allocations to authenticated;     -- escrita só por bank_line_set_allocation
create policy bank_alloc_read on public.bank_line_allocations for select to authenticated
  using (exists (select 1 from public.bank_statement_lines l where l.id = statement_line_id and private.in_org(l.org_id) and private.can_finance(l.unit_id)));

-- Conciliar um movimento com um lançamento torna a linha derivada do lançamento: a alocação manual sai (senão contaria duas vezes).
create or replace function private.bank_alloc_clear_on_match() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'matched' and old.status is distinct from 'matched' then
    delete from public.bank_line_allocations where statement_line_id = new.id;
  end if;
  return new;
end $$;
create trigger bank_alloc_clear after update of status on public.bank_statement_lines for each row execute function private.bank_alloc_clear_on_match();

-- Linha(s) efetiva(s) de UM movimento bancário, com a origem da atribuição. Sinal do movimento preservado; soma = valor do movimento.
create or replace function private.bank_line_split(p_line uuid) returns table (bucket text, cents bigint, origin text)
language sql stable security definer set search_path = '' as $$
  with l as (select * from public.bank_statement_lines where id = p_line),
  a as (select line, basis_points bp from public.bank_line_allocations where statement_line_id = p_line),
  raw as (select a.line, floor(abs(l.amount_cents)::numeric * a.bp / 10000) fl, (abs(l.amount_cents)::numeric * a.bp) - floor(abs(l.amount_cents)::numeric * a.bp / 10000) * 10000 rem from a cross join l),
  ranked as (select r.line, r.fl, (select abs(amount_cents) from l)::numeric - sum(r.fl) over () leftover, row_number() over (order by r.rem desc, r.line) rn from raw r)
  -- conciliado com recebimento: mesma divisão da venda que originou o pagamento
  select x.line, x.cents, 'recebimento'::text from l join public.payments py on py.id = l.matched_payment_id join public.receivables r on r.id = py.receivable_id
    cross join lateral private.split_sale_amount(r.sale_id, l.amount_cents) x
  union all
  -- conciliado com conta paga: saída; a divisão é feita no valor positivo e o sinal volta depois
  select x.bucket, -x.cents, 'conta_a_pagar'::text from l cross join lateral private.split_payable(l.matched_payable_id, -l.amount_cents) x where l.matched_payable_id is not null
  union all
  -- pendente/ignorado com alocação manual
  select r.line, ((case when (select amount_cents from l) < 0 then -1 else 1 end) * (r.fl + case when r.rn <= r.leftover then 1 else 0 end))::bigint, 'alocacao_manual'::text
    from ranked r where (select status from l) <> 'matched'
  union all
  -- sem nada: não classificado
  select 'unclassified'::text, l.amount_cents, 'sem_alocacao'::text from l where l.status <> 'matched' and not exists (select 1 from a)
$$;

-- p_allocations: [{"line":"physio","basis_points":6000},{"line":"academy","basis_points":4000}] (soma = 10000; linhas: physio, academy, shared). null/[] remove a alocação.
create or replace function public.bank_line_set_allocation(p_line uuid, p_allocations jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; it jsonb; v_sum int := 0; v_lines text[] := '{}'; v_old jsonb;
begin
  select * into l from public.bank_statement_lines where id = p_line and org_id = private.current_org() for update;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.status = 'matched' then raise exception 'movimento conciliado: a linha de negócio vem do lançamento conciliado (desfaça a conciliação para alocar manualmente)'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('line', line, 'basis_points', basis_points)), '[]') into v_old from public.bank_line_allocations where statement_line_id = p_line;
  if p_allocations is not null and jsonb_typeof(p_allocations) <> 'array' then raise exception 'alocação inválida'; end if;
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    for it in select * from jsonb_array_elements(p_allocations) loop
      if (it ->> 'line') not in ('physio','academy','shared') or (it ->> 'line') = any (v_lines) then raise exception 'alocação inválida: linha repetida ou desconhecida'; end if;
      if coalesce((it ->> 'basis_points')::int, 0) not between 1 and 10000 then raise exception 'alocação inválida: pontos-base fora de 1 a 10000'; end if;
      v_lines := v_lines || (it ->> 'line'); v_sum := v_sum + (it ->> 'basis_points')::int;
    end loop;
    if v_sum <> 10000 then raise exception 'a alocação precisa somar 100%% (10000 pontos-base); soma atual: %', v_sum; end if;
  end if;
  delete from public.bank_line_allocations where statement_line_id = p_line;
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    insert into public.bank_line_allocations (statement_line_id, line, basis_points, allocated_by)
      select p_line, it2 ->> 'line', (it2 ->> 'basis_points')::int, (select auth.uid()) from jsonb_array_elements(p_allocations) it2;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns, old_values, new_values)
    values (l.org_id, (select auth.uid()), 'update', 'bank_line_allocations', p_line::text, l.unit_id, array['allocations'],
            jsonb_build_object('allocations', v_old), jsonb_build_object('allocations', coalesce(p_allocations, '[]'::jsonb)));
end $$;

-- Linha(s) de cada movimento (para marcar listas). Só movimentos que o usuário pode ler.
create or replace function public.bank_line_shares(p_line_ids uuid[]) returns table (line_id uuid, bucket text, cents bigint, origin text)
language sql stable security definer set search_path = '' as $$
  select l.id, x.bucket, x.cents, x.origin from public.bank_statement_lines l cross join lateral private.bank_line_split(l.id) x
   where l.id = any (p_line_ids) and l.org_id = private.current_org() and private.can_finance(l.unit_id)
$$;

-- Quadro por linha dos MOVIMENTOS BANCÁRIOS no período (data do extrato), com a conferência contra o extrato original.
-- Entradas e saídas ficam separadas (sem compensar); "Não classificado" reúne o que ainda não tem nem lançamento conciliado nem alocação.
create or replace function public.bank_by_line(p_from date, p_to date, p_unit uuid default null, p_account uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); res jsonb;
begin
  with keys as (select * from (values ('physio', 1, 'HP Fisioterapia'), ('academy', 2, 'HP Academy'), ('shared', 3, 'Compartilhado / não alocado'), ('unclassified', 4, 'Não classificado')) v(k, ord, label)),
  scope as (select l.id, l.amount_cents, l.status from public.bank_statement_lines l join public.bank_statement_imports i on i.id = l.import_id
             where l.org_id = v_org and private.can_finance(l.unit_id) and (p_unit is null or l.unit_id = p_unit) and (p_account is null or i.account_id = p_account)
               and l.txn_date >= p_from and l.txn_date < p_to),
  sp as (select s.id, x.bucket, x.cents, x.origin from scope s cross join lateral private.bank_line_split(s.id) x),
  per as (
    select k.k as "key", k.ord, k.label,
           coalesce(sum(sp.cents) filter (where sp.cents > 0), 0) inflow_cents,
           coalesce(-sum(sp.cents) filter (where sp.cents < 0), 0) outflow_cents,
           coalesce(sum(sp.cents), 0) net_cents,
           count(distinct sp.id) movements,
           count(distinct sp.id) filter (where sp.origin in ('recebimento', 'conta_a_pagar')) from_entries,
           count(distinct sp.id) filter (where sp.origin = 'alocacao_manual') manual_allocations
      from keys k left join sp on sp.bucket = k.k group by k.k, k.ord, k.label),
  direct as (select coalesce(sum(amount_cents) filter (where amount_cents > 0), 0) inflow, coalesce(-sum(amount_cents) filter (where amount_cents < 0), 0) outflow,
                    coalesce(sum(amount_cents), 0) net, count(*) n,
                    count(*) filter (where status = 'matched') matched, count(*) filter (where status = 'ignored') ignored, count(*) filter (where status = 'unmatched') unmatched from scope),
  tot as (select sum(inflow_cents) inflow, sum(outflow_cents) outflow, sum(net_cents) net, sum(movements) movements from per)
  select jsonb_build_object(
    'lines', (select jsonb_agg(to_jsonb(per) - 'ord' order by per.ord) from per),
    'total', (select jsonb_build_object('key', 'total', 'label', 'Geral', 'inflow_cents', inflow, 'outflow_cents', outflow, 'net_cents', net) from tot),
    'statement', (select jsonb_build_object('inflow_cents', inflow, 'outflow_cents', outflow, 'net_cents', net, 'movements', n, 'matched', matched, 'ignored', ignored, 'unmatched', unmatched) from direct),
    'unallocated_movements', (select count(distinct id) from sp where origin = 'sem_alocacao'),
    'reconciliation', (select jsonb_build_object('ok', bool_and(ok), 'checks', jsonb_agg(jsonb_build_object('metric', m, 'lines_total_cents', lt, 'direct_cents', dv, 'ok', ok) order by ordn)) from (
        select 1 ordn, 'Entradas do extrato' m, (select inflow from tot) lt, (select inflow from direct) dv, (select inflow from tot) = (select inflow from direct) ok
        union all select 2, 'Saídas do extrato', (select outflow from tot), (select outflow from direct), (select outflow from tot) = (select outflow from direct)
        union all select 3, 'Saldo líquido do extrato', (select net from tot), (select net from direct), (select net from tot) = (select net from direct)) z)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------- Recorrência (MRR/ARR) por linha
-- Lê private.mrr_base (mesma fonte de mrr_report) e junta ao produto do contrato. A conferência compara a soma das linhas com mrr_report.
create or replace function public.mrr_by_line(p_month date default current_date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_month date := date_trunc('month', p_month)::date;
  v_prev date := (v_month - interval '1 month')::date;
  v_direct jsonb := public.mrr_report(p_month, p_unit);
  res jsonb;
begin
  with keys as (select * from (values ('physio', 1, 'HP Fisioterapia'), ('academy', 2, 'HP Academy'), ('unclassified', 3, 'Não classificado')) v(k, ord, label)),
  prev as (select b.contract_id, b.person_id, b.amount_cents, coalesce(pr.business_line, 'unclassified') k
             from private.mrr_base(v_prev) b left join public.products pr on pr.id = b.product_id where b.unit_id = any (u)),
  curr as (select b.contract_id, b.person_id, b.amount_cents, coalesce(pr.business_line, 'unclassified') k
             from private.mrr_base(v_month) b left join public.products pr on pr.id = b.product_id where b.unit_id = any (u)),
  per as (
    select k.k as "key", k.ord, k.label,
      coalesce((select sum(p.amount_cents) from prev p where p.k = k.k), 0) mrr_inicial_cents,
      coalesce((select sum(c.amount_cents) from curr c where c.k = k.k and not exists (select 1 from prev p where p.contract_id = c.contract_id)
                 and not private.contract_ever_active_before(c.contract_id, v_prev)), 0) novo_cents,
      coalesce((select sum(greatest(c.amount_cents - p.amount_cents, 0)) from curr c join prev p on p.contract_id = c.contract_id where c.k = k.k), 0) expansao_cents,
      coalesce((select sum(c.amount_cents) from curr c where c.k = k.k and not exists (select 1 from prev p where p.contract_id = c.contract_id)
                 and private.contract_ever_active_before(c.contract_id, v_prev)), 0) reativacao_cents,
      -coalesce((select sum(greatest(p.amount_cents - c.amount_cents, 0)) from curr c join prev p on p.contract_id = c.contract_id where c.k = k.k), 0) contracao_cents,
      -coalesce((select sum(p.amount_cents) from prev p where p.k = k.k and not exists (select 1 from curr c where c.contract_id = p.contract_id)), 0) cancelamento_cents,
      coalesce((select sum(c.amount_cents) from curr c where c.k = k.k), 0) mrr_cents,
      (select count(*) from curr c where c.k = k.k) contratos,
      (select count(distinct c.person_id) from curr c where c.k = k.k) clientes,
      (select count(distinct p.person_id) from prev p where p.k = k.k) clientes_inicial,
      (select count(distinct p.person_id) from prev p where p.k = k.k and not exists (select 1 from curr c where c.k = k.k and c.person_id = p.person_id)) clientes_perdidos
      from keys k),
  calc as (
    select per.*, per.mrr_cents * 12 arr_cents,
      (per.mrr_inicial_cents + per.novo_cents + per.expansao_cents + per.reativacao_cents + per.contracao_cents + per.cancelamento_cents) = per.mrr_cents ponte_fecha,
      case when per.mrr_inicial_cents > 0 then round(-(per.contracao_cents + per.cancelamento_cents) * 100.0 / per.mrr_inicial_cents, 1) end churn_receita_pct,
      case when per.mrr_inicial_cents > 0 then round((per.mrr_inicial_cents + per.contracao_cents + per.cancelamento_cents) * 100.0 / per.mrr_inicial_cents, 1) end retencao_bruta_pct,
      case when per.mrr_inicial_cents > 0 then round((per.mrr_inicial_cents + per.contracao_cents + per.cancelamento_cents + per.expansao_cents) * 100.0 / per.mrr_inicial_cents, 1) end retencao_liquida_pct,
      case when per.clientes_inicial > 0 then round(per.clientes_perdidos * 100.0 / per.clientes_inicial, 1) end churn_clientes_pct,
      case when per.clientes > 0 then round(per.mrr_cents::numeric / per.clientes, 0) end receita_media_cliente_cents
    from per),
  tot as (select sum(mrr_inicial_cents) ini, sum(novo_cents) novo, sum(expansao_cents) expn, sum(reativacao_cents) rea, sum(contracao_cents) con, sum(cancelamento_cents) can, sum(mrr_cents) mrr, sum(contratos) contratos from calc)
  select jsonb_build_object(
    'month', v_month,
    'lines', (select jsonb_agg(to_jsonb(calc) - 'ord' order by calc.ord) from calc),
    'total', (select jsonb_build_object('key', 'total', 'label', 'Geral', 'mrr_inicial_cents', ini, 'novo_cents', novo, 'expansao_cents', expn, 'reativacao_cents', rea, 'contracao_cents', con,
                'cancelamento_cents', can, 'mrr_cents', mrr, 'arr_cents', mrr * 12, 'contratos', contratos, 'clientes', (v_direct ->> 'clientes_recorrentes')::bigint) from tot),
    'reconciliation', (select jsonb_build_object('ok', bool_and(ok), 'checks', jsonb_agg(jsonb_build_object('metric', m, 'lines_total_cents', lt, 'direct_cents', dv, 'ok', ok) order by ordn)) from (
        select 1 ordn, 'MRR inicial' m, (select ini from tot) lt, (v_direct -> 'bridge' ->> 'mrr_inicial_cents')::bigint dv, (select ini from tot) = (v_direct -> 'bridge' ->> 'mrr_inicial_cents')::bigint ok
        union all select 2, 'Novo', (select novo from tot), (v_direct -> 'bridge' ->> 'novo_cents')::bigint, (select novo from tot) = (v_direct -> 'bridge' ->> 'novo_cents')::bigint
        union all select 3, 'Expansão', (select expn from tot), (v_direct -> 'bridge' ->> 'expansao_cents')::bigint, (select expn from tot) = (v_direct -> 'bridge' ->> 'expansao_cents')::bigint
        union all select 4, 'Reativação', (select rea from tot), (v_direct -> 'bridge' ->> 'reativacao_cents')::bigint, (select rea from tot) = (v_direct -> 'bridge' ->> 'reativacao_cents')::bigint
        union all select 5, 'Contração', (select con from tot), (v_direct -> 'bridge' ->> 'contracao_cents')::bigint, (select con from tot) = (v_direct -> 'bridge' ->> 'contracao_cents')::bigint
        union all select 6, 'Cancelamento', (select can from tot), (v_direct -> 'bridge' ->> 'cancelamento_cents')::bigint, (select can from tot) = (v_direct -> 'bridge' ->> 'cancelamento_cents')::bigint
        union all select 7, 'MRR final', (select mrr from tot), (v_direct -> 'mrr_cents' ->> 'value')::bigint, (select mrr from tot) = (v_direct -> 'mrr_cents' ->> 'value')::bigint
        union all select 8, 'ARR', (select mrr * 12 from tot), (v_direct -> 'arr_cents' ->> 'value')::bigint, (select mrr * 12 from tot) = (v_direct -> 'arr_cents' ->> 'value')::bigint) z),
    'unclassified_contracts', (select count(*) from curr where k = 'unclassified')
  ) into res;
  return res;
end $$;

-- MRR dos últimos meses, por linha (mesma base de mrr_history).
create or replace function public.mrr_history_by_line(p_months int default 12, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); v_from date := date_trunc('month', current_date - (p_months - 1) * interval '1 month')::date;
begin
  return coalesce((select jsonb_agg(jsonb_build_object('month', m::date, 'physio', t.physio, 'academy', t.academy, 'unclassified', t.unclassified, 'total', t.total) order by m)
    from generate_series(v_from, date_trunc('month', current_date)::date, interval '1 month') m
    left join lateral (
      select coalesce(sum(b.amount_cents) filter (where coalesce(pr.business_line, 'unclassified') = 'physio'), 0) physio,
             coalesce(sum(b.amount_cents) filter (where coalesce(pr.business_line, 'unclassified') = 'academy'), 0) academy,
             coalesce(sum(b.amount_cents) filter (where coalesce(pr.business_line, 'unclassified') = 'unclassified'), 0) unclassified,
             coalesce(sum(b.amount_cents), 0) total
        from private.mrr_base(m::date) b left join public.products pr on pr.id = b.product_id where b.unit_id = any (u)) t on true), '[]');
end $$;

-- ---------------------------------------------------------------- Relatórios de eficiência por linha
create or replace function public.efficiency_by_line(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); res jsonb;
begin
  with keys as (select * from (values ('physio', 1, 'HP Fisioterapia'), ('academy', 2, 'HP Academy'), ('unclassified', 3, 'Não classificado')) v(k, ord, label)),
  rec as (select x.line k, sum(case when py.kind = 'payment' then x.cents else -x.cents end) v
            from public.payments py join public.receivables r on r.id = py.receivable_id cross join lateral private.split_sale_amount(r.sale_id, py.amount_cents) x
           where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to group by 1),
  pay as (select coalesce(pr.business_line, 'unclassified') k, count(distinct s.person_id) v
            from public.sales s join public.sale_items si on si.sale_id = s.id join public.products pr on pr.id = si.product_id
           where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to group by 1),
  att as (select coalesce(pr.business_line, 'unclassified') k, count(*) v
            from public.appointments a left join public.client_packages cp on cp.id = a.client_package_id left join public.products pr on pr.id = cp.product_id
           where a.unit_id = any (u) and a.status = 'attended' and lower(a.period) >= p_from and lower(a.period) < p_to group by 1),
  buy as (select coalesce(pr.business_line, 'unclassified') k, s.person_id, count(distinct s.id) n
            from public.sales s join public.sale_items si on si.sale_id = s.id join public.products pr on pr.id = si.product_id
           where s.unit_id = any (u) and s.status = 'confirmed' group by 1, 2),
  buy_k as (select k, count(*) buyers, count(*) filter (where n > 1) repeaters from buy group by k),
  per as (
    select k.k as "key", k.ord, k.label, coalesce(r.v, 0) net_received_cents, coalesce(p.v, 0) paying_patients, coalesce(a.v, 0) attended_sessions,
           coalesce(b.buyers, 0) buyers, coalesce(b.repeaters, 0) repeat_buyers,
           case when coalesce(p.v, 0) > 0 then round(coalesce(r.v, 0)::numeric / p.v, 0) end revenue_per_patient_cents,
           case when coalesce(a.v, 0) > 0 then round(coalesce(r.v, 0)::numeric / a.v, 0) end revenue_per_session_cents,
           case when coalesce(b.buyers, 0) > 0 then round(coalesce(b.repeaters, 0) * 100.0 / b.buyers, 1) end repurchase_pct
      from keys k left join rec r on r.k = k.k left join pay p on p.k = k.k left join att a on a.k = k.k left join buy_k b on b.k = k.k),
  tot as (select sum(net_received_cents) net, sum(attended_sessions) att from per),
  direct as (
    select (select coalesce(sum(case py.kind when 'payment' then py.amount_cents else -py.amount_cents end), 0) from public.payments py where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to) net,
           (select count(*) from public.appointments a where a.unit_id = any (u) and a.status = 'attended' and lower(a.period) >= p_from and lower(a.period) < p_to) att,
           (select count(distinct person_id) from public.sales where unit_id = any (u) and status = 'confirmed' and sold_at >= p_from and sold_at < p_to) patients,
           (select count(distinct person_id) from public.sales where unit_id = any (u) and status = 'confirmed') buyers,
           (select count(*) from (select person_id from public.sales where unit_id = any (u) and status = 'confirmed' group by person_id having count(*) > 1) x) repeaters),
  conc as (
    select p.name product_name, coalesce(p.business_line, 'unclassified') business_line, sum(case py.kind when 'payment' then py.amount_cents else -py.amount_cents end) received_cents
      from public.payments py join public.receivables r on r.id = py.receivable_id join public.products p on p.id = r.product_id
     where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to group by p.name, p.business_line)
  select jsonb_build_object(
    'lines', (select jsonb_agg(to_jsonb(per) - 'ord' order by per.ord) from per),
    'general', (select jsonb_build_object('net_received_cents', net, 'attended_sessions', att, 'paying_patients', patients, 'buyers', buyers, 'repeat_buyers', repeaters,
                'revenue_per_patient_cents', case when patients > 0 then round(net::numeric / patients, 0) end,
                'revenue_per_session_cents', case when att > 0 then round(net::numeric / att, 0) end,
                'repurchase_pct', case when buyers > 0 then round(repeaters * 100.0 / buyers, 1) end) from direct),
    'concentration', (select coalesce(jsonb_agg(jsonb_build_object('product_name', c2.product_name, 'business_line', c2.business_line, 'received_cents', c2.received_cents, 'share_pct_of_line', c2.share) order by c2.received_cents desc), '[]')
                      from (select c.*, round(c.received_cents * 100.0 / nullif(sum(c.received_cents) over (partition by c.business_line), 0), 1) share from conc c order by c.received_cents desc limit 40) c2),
    'reconciliation', (select jsonb_build_object('ok', bool_and(ok), 'checks', jsonb_agg(jsonb_build_object('metric', m, 'lines_total_cents', lt, 'direct_cents', dv, 'ok', ok) order by ordn)) from (
        select 1 ordn, 'Recebido líquido' m, (select net from tot) lt, (select net from direct) dv, (select net from tot) = (select net from direct) ok
        union all select 2, 'Atendimentos realizados (quantidade)', (select att from tot), (select att from direct), (select att from tot) = (select att from direct)) z)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------- privilégios (CREATE OR REPLACE zera GRANTs; aqui são funções novas)
revoke all on function public.bank_line_set_allocation(uuid, jsonb), public.bank_line_shares(uuid[]), public.bank_by_line(date, date, uuid, uuid),
  public.mrr_by_line(date, uuid), public.mrr_history_by_line(int, uuid), public.efficiency_by_line(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.bank_line_set_allocation(uuid, jsonb), public.bank_line_shares(uuid[]), public.bank_by_line(date, date, uuid, uuid),
  public.mrr_by_line(date, uuid), public.mrr_history_by_line(int, uuid), public.efficiency_by_line(timestamptz, timestamptz, uuid) to authenticated;
