-- HP Group Hub — 024 MRR contratual de verdade: audita e substitui a origem do MRR/ARR da migration 020.
--
-- PROBLEMA ENCONTRADO NA AUDITORIA (ver docs/metrics.md para o texto completo):
-- O MRR anterior usava products.recurrence='monthly' + receivables.competence_month. Isso é o mesmo sinal que já
-- alimentava subscription_forecast — e ali ele SEMPRE foi só uma heurística de projeção por pagamento, nunca um
-- contrato. Prova concreta: h_sale_confirmed() gera TODAS as parcelas de UMA VEZ na confirmação da venda
-- (for i in 1..s.installments), para QUALQUER produto, recorrente ou não. Então uma venda parcelada em 6x de um
-- produto marcado "monthly" virava "6 meses de MRR" mesmo sendo uma compra avulsa financiada — não uma assinatura
-- em aberto. E uma assinatura real que dura mais que o "installments" inicial simplesmente "cancelava" sozinha
-- quando as parcelas acabavam, mesmo continuando ativa de fato.
--
-- CORREÇÃO: MRR agora vem de um contrato recorrente EXPLÍCITO, com vigência por data efetiva — totalmente
-- desacoplado de sales/receivables/payments. Pagamento em atraso não cancela o contrato (só um "cancel" explícito
-- cancela); estorno de pagamento não mexe no MRR (MRR é compromisso contratual, não caixa). "Novo mínimo
-- necessário" pedido no briefing — sem cobrança automática, sem gateway.

create table public.recurring_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  billing_period text not null check (billing_period in ('monthly','quarterly','semiannual','annual')),
  source_sale_id uuid references public.sales(id) on delete set null,   -- rastreabilidade opcional; nunca gera nem exige venda
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index recurring_contracts_unit_idx on public.recurring_contracts (unit_id);
create index recurring_contracts_person_idx on public.recurring_contracts (person_id);

-- Uma linha por mudança de vigência: nunca sobrescreve a anterior (histórico imutável — mudar hoje não reescreve
-- o MRR de meses passados). O estado "no dia X" é sempre a última linha com effective_on <= X.
create table public.recurring_contract_changes (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.recurring_contracts(id) on delete cascade,
  effective_on date not null,
  change_type text not null check (change_type in ('start','expansion','contraction','pause','resume','cancel')),
  gross_monthly_cents bigint check (gross_monthly_cents >= 0),          -- já normalizado para mensal (ver recurring_contract_start/_change)
  discount_monthly_cents bigint not null default 0 check (discount_monthly_cents >= 0),
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (change_type not in ('start','expansion','contraction','resume') or gross_monthly_cents is not null),
  check (change_type not in ('contraction','cancel') or coalesce(btrim(reason), '') <> ''),
  check (discount_monthly_cents <= coalesce(gross_monthly_cents, 0))
);
create index rcc_contract_idx on public.recurring_contract_changes (contract_id, effective_on, created_at);

alter table public.recurring_contracts enable row level security;
alter table public.recurring_contract_changes enable row level security;
grant select on public.recurring_contracts, public.recurring_contract_changes to authenticated;

create policy rc_read on public.recurring_contracts for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));
create policy rcc_read on public.recurring_contract_changes for select to authenticated using (exists (select 1 from public.recurring_contracts c where c.id = contract_id and private.can_finance(c.unit_id)));

create trigger audit_recurring_contracts after insert on public.recurring_contracts for each row execute function private.audit_row('person_id','product_id','billing_period');
create trigger audit_recurring_contract_changes after insert on public.recurring_contract_changes for each row execute function private.audit_row('change_type','effective_on','gross_monthly_cents');

-- ---------------------------------------------------------------- criação e mudanças (validação no servidor; nunca direto pela tabela)
-- Normalização de periodicidade: o valor é sempre informado NO PERÍODO contratado (ex.: anual = valor do ano) e
-- a função converte para mensal — nunca confia em conversão feita no cliente.
create or replace function private.months_in_period(p_period text) returns int
language sql immutable set search_path = '' as $$
  select case p_period when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 end
$$;

create or replace function public.recurring_contract_start(p_person uuid, p_unit uuid, p_product uuid, p_billing_period text,
  p_period_amount_cents bigint, p_period_discount_cents bigint default 0, p_starts_on date default current_date,
  p_source_sale uuid default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid; v_months int := private.months_in_period(p_billing_period);
begin
  if v_org is null or not private.can_finance(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'pessoa inválida'; end if;
  if v_months is null then raise exception 'periodicidade inválida'; end if;
  if p_period_amount_cents is null or p_period_amount_cents <= 0 then raise exception 'informe o valor do período'; end if;
  if coalesce(p_period_discount_cents, 0) > p_period_amount_cents then raise exception 'desconto maior que o valor do período'; end if;
  if p_source_sale is not null and not exists (select 1 from public.sales where id = p_source_sale and person_id = p_person and org_id = v_org) then raise exception 'venda não pertence à pessoa'; end if;
  insert into public.recurring_contracts (org_id, unit_id, person_id, product_id, billing_period, source_sale_id, notes, created_by)
    values (v_org, p_unit, p_person, p_product, p_billing_period, p_source_sale, p_notes, (select auth.uid())) returning id into v_id;
  insert into public.recurring_contract_changes (contract_id, effective_on, change_type, gross_monthly_cents, discount_monthly_cents, created_by)
    values (v_id, coalesce(p_starts_on, current_date), 'start', round(p_period_amount_cents::numeric / v_months), round(coalesce(p_period_discount_cents, 0)::numeric / v_months), (select auth.uid()));
  return v_id;
end $$;

-- expansão/contração/pausa/retomada/cancelamento: sempre um novo registro, nunca reescreve o anterior.
create or replace function public.recurring_contract_change(p_contract uuid, p_change_type text, p_effective_on date,
  p_period_amount_cents bigint default null, p_period_discount_cents bigint default 0, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.recurring_contracts; v_months int; v_id uuid; v_first_start date; v_gross bigint; v_disc bigint;
begin
  select * into c from public.recurring_contracts where id = p_contract;
  if not found or not private.can_finance(c.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_change_type not in ('expansion','contraction','pause','resume','cancel') then raise exception 'tipo de mudança inválido'; end if;
  select min(effective_on) into v_first_start from public.recurring_contract_changes where contract_id = p_contract and change_type = 'start';
  if p_effective_on < v_first_start then raise exception 'data efetiva não pode ser anterior ao início do contrato'; end if;
  if p_change_type in ('contraction','cancel') and coalesce(btrim(p_reason), '') = '' then raise exception 'informe o motivo'; end if;
  if p_change_type in ('expansion','contraction','resume') then
    v_months := private.months_in_period(c.billing_period);
    if p_period_amount_cents is null or p_period_amount_cents <= 0 then raise exception 'informe o valor do período'; end if;
    if coalesce(p_period_discount_cents, 0) > p_period_amount_cents then raise exception 'desconto maior que o valor do período'; end if;
    v_gross := round(p_period_amount_cents::numeric / v_months); v_disc := round(coalesce(p_period_discount_cents, 0)::numeric / v_months);
  end if;
  insert into public.recurring_contract_changes (contract_id, effective_on, change_type, gross_monthly_cents, discount_monthly_cents, reason, created_by)
    values (p_contract, p_effective_on, p_change_type, v_gross, coalesce(v_disc, 0), p_reason, (select auth.uid())) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- leitura de estado por data de referência (histórico nunca é reescrito)
-- Última mudança com effective_on <= p_asof define o estado do contrato NAQUELA data — consultar uma data
-- passada sempre reflete o que era verdade então, mesmo que mudanças mais recentes tenham sido lançadas depois.
create or replace function private.contract_state_at(p_asof date) returns table (contract_id uuid, unit_id uuid, person_id uuid, product_id uuid, status text, monthly_cents bigint)
language sql stable security definer set search_path = '' as $$
  select distinct on (c.id) c.id, c.unit_id, c.person_id, c.product_id,
    case ch.change_type when 'pause' then 'paused' when 'cancel' then 'cancelled' else 'active' end,
    coalesce(ch.gross_monthly_cents - ch.discount_monthly_cents, 0)
  from public.recurring_contracts c
  join public.recurring_contract_changes ch on ch.contract_id = c.id and ch.effective_on <= p_asof
  order by c.id, ch.effective_on desc, ch.created_at desc
$$;

-- base do MRR do mês M: contratos com status "active" no ÚLTIMO dia do mês (convenção: MRR "de M" = posição no fim de M)
-- Substitui a private.mrr_base(date) da migration 020 (fonte trocada de receivables para contratos) — o conjunto
-- de colunas mudou (ganhou contract_id), então precisa DROP antes: CREATE OR REPLACE não troca o tipo de retorno.
drop function if exists private.mrr_base(date);
create function private.mrr_base(p_month date) returns table (person_id uuid, product_id uuid, amount_cents bigint, unit_id uuid, contract_id uuid)
language sql stable security definer set search_path = '' as $$
  select person_id, product_id, monthly_cents, unit_id, contract_id
  from private.contract_state_at((date_trunc('month', p_month) + interval '1 month - 1 day')::date)
  where status = 'active'
$$;

-- "já teve alguma vez antes de M-1" — para novo × reativação, independente de estar ativo num fim-de-mês específico
create or replace function private.contract_ever_active_before(p_contract uuid, p_before date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.recurring_contract_changes where contract_id = p_contract and effective_on < p_before and change_type in ('start','expansion','contraction','resume'))
$$;

grant execute on function public.recurring_contract_start(uuid, uuid, uuid, text, bigint, bigint, date, uuid, text),
  public.recurring_contract_change(uuid, text, date, bigint, bigint, text) to authenticated;
