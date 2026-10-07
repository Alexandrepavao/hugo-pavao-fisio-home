-- HP Group Hub — 057 Separação financeira por linha de negócio (HP Fisioterapia / HP Academy) dentro da MESMA organização.
-- ADITIVA: nenhuma função financeira existente é alterada — a visão "Geral" (dashboard_metrics, dre_report, vendas, recebíveis…) continua igual.
-- As linhas entram por colunas novas e por funções novas que se reconciliam com as bases originais (finance_by_line traz o quadro de conferência).
-- Linhas de negócio NÃO são unidades, empresas ou bancos.
--   • Receitas (vendas, recebimentos, estornos, comissões, previsão): a linha é do PRODUTO de cada item da venda (products.business_line).
--     Venda com itens das duas linhas → o valor é dividido proporcionalmente ao líquido de cada item (desconto da venda diluído proporcionalmente),
--     em centavos exatos (o resto vai à linha de maior resto) — a soma das linhas é SEMPRE o valor original, sem duplicar.
--   • Despesas: payables.business_line; "compartilhada" só é dividida com rateio EXPLÍCITO (payable_allocations); sem rateio fica como "Compartilhado / não alocado".
--   • Sem classificação = "Não classificado" (nunca se adivinha a linha de produto/despesa antigo).
--   • Reclassificar um produto reclassifica todo o histórico dele (é uma classificação, não um lançamento contábil); fica auditado.

-- ---------------------------------------------------------------- colunas e rateio
alter table public.products add column business_line text not null default 'unclassified' check (business_line in ('physio','academy','unclassified'));
alter table public.payables add column business_line text not null default 'unclassified' check (business_line in ('physio','academy','shared','unclassified'));

create table public.payable_allocations (
  payable_id uuid not null references public.payables(id) on delete cascade,
  line text not null check (line in ('physio','academy')),
  basis_points int not null check (basis_points between 1 and 10000),
  primary key (payable_id, line)
);
alter table public.payable_allocations enable row level security;
grant select on public.payable_allocations to authenticated;     -- escrita só por payable_set_line (valida que soma = 10.000 pontos-base)
create policy payable_alloc_read on public.payable_allocations for select to authenticated
  using (exists (select 1 from public.payables p where p.id = payable_id and private.can_finance(p.unit_id)));

-- auditoria da classificação (colunas novas entram no trigger existente)
drop trigger if exists audit_payables on public.payables;
create trigger audit_payables after insert or update on public.payables for each row execute function private.audit_row('status','amount_cents','business_line');
drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products for each row execute function private.audit_row('name','price_cents','active','kind','business_line');

-- ---------------------------------------------------------------- divisões exatas em centavos
-- Divide um valor de UMA venda entre as linhas dos seus itens, proporcional ao líquido de cada item. Sinal preservado (estorno/comissão negativa).
create or replace function private.split_sale_amount(p_sale uuid, p_amount bigint) returns table (line text, cents bigint)
language sql stable security definer set search_path = '' as $$
  with w as (
    select coalesce(pr.business_line, 'unclassified') line, sum((si.qty * si.unit_price_cents - si.discount_cents)::numeric) wt
      from public.sale_items si join public.products pr on pr.id = si.product_id where si.sale_id = p_sale group by 1),
  t as (select sum(wt) tot from w),
  raw as (
    select w.line, floor(abs(p_amount)::numeric * w.wt / t.tot) fl, (abs(p_amount)::numeric * w.wt) - floor(abs(p_amount)::numeric * w.wt / t.tot) * t.tot rem
      from w cross join t where t.tot > 0),
  ranked as (select r.line, r.fl, abs(p_amount)::numeric - sum(r.fl) over () leftover, row_number() over (order by r.rem desc, r.line) rn from raw r)
  select r.line, ((case when p_amount < 0 then -1 else 1 end) * (r.fl + case when r.rn <= r.leftover then 1 else 0 end))::bigint from ranked r
  union all
  select 'unclassified'::text, p_amount where p_amount <> 0 and not exists (select 1 from raw)
$$;

-- Divide um valor de UMA despesa entre os baldes: física/academy/não classificada (100%) ou compartilhada (por rateio explícito; sem rateio = "shared").
create or replace function private.split_payable(p_payable uuid, p_amount bigint) returns table (bucket text, cents bigint)
language sql stable security definer set search_path = '' as $$
  with p as (select business_line bl from public.payables where id = p_payable),
  a as (select line, basis_points bp from public.payable_allocations where payable_id = p_payable),
  raw as (select a.line, floor(p_amount::numeric * a.bp / 10000) fl, (p_amount::numeric * a.bp) - floor(p_amount::numeric * a.bp / 10000) * 10000 rem from a),
  ranked as (select r.line, r.fl, p_amount::numeric - sum(r.fl) over () leftover, row_number() over (order by r.rem desc, r.line) rn from raw r)
  select p.bl, p_amount from p where p.bl in ('physio','academy','unclassified')
  union all
  select r.line, (r.fl + case when r.rn <= r.leftover then 1 else 0 end)::bigint from ranked r cross join p where p.bl = 'shared'
  union all
  select 'shared'::text, p_amount from p where p.bl = 'shared' and not exists (select 1 from a)
$$;

-- ---------------------------------------------------------------- classificação (escritas validadas e auditadas)
create or replace function public.product_set_line(p_product uuid, p_line text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_line not in ('physio','academy','unclassified') then raise exception 'linha de negócio inválida'; end if;
  update public.products set business_line = p_line where id = p_product and org_id = private.current_org();
  if not found then raise exception 'produto não encontrado'; end if;
end $$;

-- p_allocations (só para 'shared'): [{"line":"physio","basis_points":6000},{"line":"academy","basis_points":4000}]; a soma tem que ser 10000.
-- 'shared' sem p_allocations fica como "Compartilhado / não alocado".
create or replace function public.payable_set_line(p_payable uuid, p_line text, p_allocations jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.payables; it jsonb; v_sum int := 0; v_lines text[] := '{}';
begin
  select * into b from public.payables where id = p_payable and org_id = private.current_org() for update;
  if not found or not private.can_finance(b.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_line not in ('physio','academy','shared','unclassified') then raise exception 'linha de negócio inválida'; end if;
  if p_allocations is not null and p_line <> 'shared' then raise exception 'rateio só se aplica a despesa compartilhada'; end if;
  if p_allocations is not null then
    if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then raise exception 'rateio inválido'; end if;
    for it in select * from jsonb_array_elements(p_allocations) loop
      if (it ->> 'line') not in ('physio','academy') or (it ->> 'line') = any (v_lines) then raise exception 'rateio inválido: linha repetida ou desconhecida'; end if;
      if coalesce((it ->> 'basis_points')::int, 0) not between 1 and 10000 then raise exception 'rateio inválido: pontos-base fora de 1 a 10000'; end if;
      v_lines := v_lines || (it ->> 'line'); v_sum := v_sum + (it ->> 'basis_points')::int;
    end loop;
    if v_sum <> 10000 then raise exception 'o rateio precisa somar 100%% (10000 pontos-base); soma atual: %', v_sum; end if;
  end if;
  delete from public.payable_allocations where payable_id = p_payable;
  if p_allocations is not null then
    insert into public.payable_allocations (payable_id, line, basis_points)
      select p_payable, it2 ->> 'line', (it2 ->> 'basis_points')::int from jsonb_array_elements(p_allocations) it2;
  end if;
  update public.payables set business_line = p_line where id = p_payable;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns, old_values, new_values)
    values (b.org_id, (select auth.uid()), 'update', 'payable_allocations', p_payable::text, b.unit_id, array['business_line','allocations'],
            jsonb_build_object('business_line', b.business_line), jsonb_build_object('business_line', p_line, 'allocations', p_allocations));
end $$;

-- Linha(s) de cada venda (para marcar/filtrar listas): uma linha por (venda, linha) com o valor dessa linha. Só vendas que o usuário pode ler.
create or replace function public.sale_line_shares(p_sale_ids uuid[]) returns table (sale_id uuid, line text, cents bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, x.line, x.cents from public.sales s cross join lateral private.split_sale_amount(s.id, s.total_cents) x
   where s.id = any (p_sale_ids) and s.org_id = private.current_org() and private.can_read_sales(s.unit_id)
$$;

-- ---------------------------------------------------------------- quadro por linha + conferência com o consolidado
-- Bases (cada uma mantém o seu critério; a linha só ATRIBUI, não muda o critério):
--   vendas confirmadas (sold_at) · recebimentos/estornos (paid_at — CAIXA) · receita reconhecida (regra de results_by_product — serviço prestado)
--   comissões (pelo pagamento que as gerou) · despesas pagas (paid_at — CAIXA) · despesas por competência (competence_month) · previsão (parcelas e contas em aberto que vencem no período).
create or replace function public.finance_by_line(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); res jsonb;
begin
  with keys as (select * from (values ('physio', 1, 'HP Fisioterapia'), ('academy', 2, 'HP Academy'), ('shared', 3, 'Compartilhado / não alocado'), ('unclassified', 4, 'Não classificado')) v(k, ord, label)),
  sales_l as (select x.line k, sum(x.cents) v from public.sales s cross join lateral private.split_sale_amount(s.id, s.total_cents) x
               where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to group by 1),
  pay_l as (select x.line k, coalesce(sum(x.cents) filter (where py.kind = 'payment'), 0) rec, coalesce(sum(x.cents) filter (where py.kind = 'refund'), 0) ref
              from public.payments py join public.receivables r on r.id = py.receivable_id cross join lateral private.split_sale_amount(r.sale_id, py.amount_cents) x
             where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to group by 1),
  fc_l as (select x.line k, sum(x.cents) v from public.receivables r
             cross join lateral private.split_sale_amount(r.sale_id, greatest(r.amount_cents - private.receivable_net(r.id), 0)) x
            where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date >= p_from::date and r.due_date < p_to::date group by 1),
  rec_l as (select coalesce(pr.business_line, 'unclassified') k, sum(rp.recognized_cents) v from public.results_by_product(p_from, p_to, p_unit) rp
              join public.products pr on pr.id = rp.product_id group by 1),
  com_l as (select x.line k, sum(x.cents) v from public.commission_entries ce join public.payments py on py.id = ce.payment_id
              cross join lateral private.split_sale_amount(ce.sale_id, ce.amount_cents) x
             where ce.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to group by 1),
  exp_c as (select x.bucket k, coalesce(fc.dre_classification, 'sem_classificacao') c, sum(x.cents) v from public.payables b
              cross join lateral private.split_payable(b.id, b.amount_cents) x left join public.finance_categories fc on fc.id = b.category_id
             where b.unit_id = any (u) and b.status = 'paid' and b.paid_at >= p_from and b.paid_at < p_to group by 1, 2),
  exp_k as (select k, sum(v) v, coalesce(sum(v) filter (where c = 'deducao'), 0) ded, coalesce(sum(v) filter (where c = 'custo_direto'), 0) cd,
                   coalesce(sum(v) filter (where c = 'despesa_operacional'), 0) dop, coalesce(sum(v) filter (where c = 'sem_classificacao'), 0) sc from exp_c group by k),
  comp_l as (select x.bucket k, sum(x.cents) v from public.payables b cross join lateral private.split_payable(b.id, b.amount_cents) x
              where b.unit_id = any (u) and b.status <> 'cancelled' and b.competence_month >= p_from::date and b.competence_month < p_to::date group by 1),
  pfc_l as (select x.bucket k, sum(x.cents) v from public.payables b cross join lateral private.split_payable(b.id, b.amount_cents) x
             where b.unit_id = any (u) and b.status = 'open' and b.due_date >= p_from::date and b.due_date < p_to::date group by 1),
  per as (
    select k.k as "key", k.ord, k.label,
           coalesce(s.v, 0) sales_cents, coalesce(p.rec, 0) receipts_cents, coalesce(p.ref, 0) refunds_cents, coalesce(p.rec, 0) - coalesce(p.ref, 0) net_receipts_cents,
           coalesce(f.v, 0) forecast_receivables_cents, coalesce(r.v, 0) recognized_cents, coalesce(c.v, 0) commissions_cents,
           coalesce(e.v, 0) expenses_paid_cents, coalesce(cp.v, 0) expenses_competence_cents, coalesce(pf.v, 0) expenses_forecast_cents,
           coalesce(e.ded, 0) deducoes_cents, coalesce(e.cd, 0) custos_diretos_cents, coalesce(e.dop, 0) despesas_operacionais_cents, coalesce(e.sc, 0) sem_classificacao_cents,
           coalesce(r.v, 0) - coalesce(e.ded, 0) - coalesce(e.cd, 0) - coalesce(e.dop, 0) resultado_operacional_cents,
           coalesce(p.rec, 0) - coalesce(p.ref, 0) - coalesce(e.v, 0) resultado_caixa_cents
      from keys k left join sales_l s on s.k = k.k left join pay_l p on p.k = k.k left join fc_l f on f.k = k.k left join rec_l r on r.k = k.k left join com_l c on c.k = k.k
           left join exp_k e on e.k = k.k left join comp_l cp on cp.k = k.k left join pfc_l pf on pf.k = k.k),
  direct as (
    select (select coalesce(sum(s.total_cents), 0) from public.sales s where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to) sales_d,
           (select coalesce(sum(py.amount_cents) filter (where py.kind = 'payment'), 0) from public.payments py where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to) rec_d,
           (select coalesce(sum(py.amount_cents) filter (where py.kind = 'refund'), 0) from public.payments py where py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to) ref_d,
           (select coalesce(sum(greatest(r.amount_cents - private.receivable_net(r.id), 0)), 0) from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date >= p_from::date and r.due_date < p_to::date) fc_d,
           (select coalesce(sum(rp.recognized_cents), 0) from public.results_by_product(p_from, p_to, p_unit) rp) recog_d,
           (select coalesce(sum(ce.amount_cents), 0) from public.commission_entries ce join public.payments py on py.id = ce.payment_id where ce.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to) com_d,
           (select coalesce(sum(b.amount_cents), 0) from public.payables b where b.unit_id = any (u) and b.status = 'paid' and b.paid_at >= p_from and b.paid_at < p_to) exp_d,
           (select coalesce(sum(b.amount_cents), 0) from public.payables b where b.unit_id = any (u) and b.status <> 'cancelled' and b.competence_month >= p_from::date and b.competence_month < p_to::date) comp_d,
           (select coalesce(sum(b.amount_cents), 0) from public.payables b where b.unit_id = any (u) and b.status = 'open' and b.due_date >= p_from::date and b.due_date < p_to::date) pfc_d),
  tot as (select sum(sales_cents) sales, sum(receipts_cents) rec, sum(refunds_cents) ref, sum(net_receipts_cents) net, sum(forecast_receivables_cents) fc, sum(recognized_cents) recog,
                 sum(commissions_cents) com, sum(expenses_paid_cents) exp, sum(expenses_competence_cents) comp, sum(expenses_forecast_cents) pfc,
                 sum(deducoes_cents) ded, sum(custos_diretos_cents) cd, sum(despesas_operacionais_cents) dop, sum(sem_classificacao_cents) sc,
                 sum(resultado_operacional_cents) res_op, sum(resultado_caixa_cents) res_cx from per)
  select jsonb_build_object(
    'lines', (select jsonb_agg(to_jsonb(per) - 'ord' order by per.ord) from per),
    'total', (select jsonb_build_object('key', 'total', 'label', 'Geral', 'sales_cents', sales, 'receipts_cents', rec, 'refunds_cents', ref, 'net_receipts_cents', net, 'forecast_receivables_cents', fc,
                'recognized_cents', recog, 'commissions_cents', com, 'expenses_paid_cents', exp, 'expenses_competence_cents', comp, 'expenses_forecast_cents', pfc,
                'deducoes_cents', ded, 'custos_diretos_cents', cd, 'despesas_operacionais_cents', dop, 'sem_classificacao_cents', sc, 'resultado_operacional_cents', res_op, 'resultado_caixa_cents', res_cx) from tot),
    'reconciliation', (select jsonb_build_object('ok', bool_and(ok), 'checks', jsonb_agg(jsonb_build_object('metric', m, 'lines_total_cents', lt, 'direct_cents', dv, 'ok', ok) order by ordn)) from (
        select 1 ordn, 'Vendas confirmadas' m, (select sales from tot) lt, (select sales_d from direct) dv, (select sales from tot) = (select sales_d from direct) ok
        union all select 2, 'Recebimentos', (select rec from tot), (select rec_d from direct), (select rec from tot) = (select rec_d from direct)
        union all select 3, 'Estornos', (select ref from tot), (select ref_d from direct), (select ref from tot) = (select ref_d from direct)
        union all select 4, 'Parcelas a receber (previsão)', (select fc from tot), (select fc_d from direct), (select fc from tot) = (select fc_d from direct)
        union all select 5, 'Receita reconhecida', (select recog from tot), (select recog_d from direct), (select recog from tot) = (select recog_d from direct)
        union all select 6, 'Comissões', (select com from tot), (select com_d from direct), (select com from tot) = (select com_d from direct)
        union all select 7, 'Despesas pagas', (select exp from tot), (select exp_d from direct), (select exp from tot) = (select exp_d from direct)
        union all select 8, 'Despesas por competência', (select comp from tot), (select comp_d from direct), (select comp from tot) = (select comp_d from direct)
        union all select 9, 'Despesas a pagar (previsão)', (select pfc from tot), (select pfc_d from direct), (select pfc from tot) = (select pfc_d from direct)) z),
    'unclassified_products', (select count(*) from public.products where org_id = private.current_org() and active and business_line = 'unclassified'),
    'unclassified_payables_open_or_paid', (select count(*) from public.payables where unit_id = any (u) and status <> 'cancelled' and business_line = 'unclassified'),
    'shared_without_allocation', (select count(*) from public.payables b where b.unit_id = any (u) and b.status <> 'cancelled' and b.business_line = 'shared' and not exists (select 1 from public.payable_allocations a where a.payable_id = b.id))
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.product_set_line(uuid, text), public.payable_set_line(uuid, text, jsonb), public.sale_line_shares(uuid[]), public.finance_by_line(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.product_set_line(uuid, text), public.payable_set_line(uuid, text, jsonb), public.sale_line_shares(uuid[]), public.finance_by_line(timestamptz, timestamptz, uuid) to authenticated;

-- Auxiliares internos de divisão: só as funções públicas (security definer) os chamam.
revoke all on function private.split_sale_amount(uuid, bigint), private.split_payable(uuid, bigint) from public, anon, authenticated;
