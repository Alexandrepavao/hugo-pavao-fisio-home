-- Duplo clique e retentativa não podem gerar efeitos duplicados nas duas pontas do fluxo comercial:
--  (1) sale_create: ganha chave de idempotência opcional (a mesma chave devolve a MESMA venda; chamadas concorrentes com a mesma chave também) e uma oportunidade só pode ter UMA venda
--      pendente por vez (antes, repetir a chamada criava duas vendas pendentes para a mesma oportunidade);
--  (2) crm_create_opportunity: recusa criar outra oportunidade ABERTA da mesma pessoa no mesmo funil (antes, dois cliques criavam duas).
-- Mudança aditiva: parâmetros novos com padrão; todas as chamadas existentes (nomeadas) continuam valendo. Dev: não havia nenhuma duplicidade preexistente (conferido antes do índice).

alter table public.sales add column if not exists idempotency_key text;
create unique index if not exists sales_idempotency_uq on public.sales (org_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists sales_one_pending_per_opportunity_uq on public.sales (opportunity_id) where status = 'pending' and opportunity_id is not null;

drop function if exists public.sale_create(uuid, uuid, uuid, jsonb, bigint, int, date, text);
create or replace function public.sale_create(p_person uuid, p_unit uuid, p_opportunity uuid, p_items jsonb,
  p_discount_cents bigint default 0, p_installments int default 1, p_first_due date default current_date, p_notes text default null, p_idempotency_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid; it jsonb; pr public.products; v_price bigint; v_prev public.sales;
begin
  if v_org is null or not private.can_sell(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'pessoa inválida'; end if;
  if p_opportunity is not null and not exists (select 1 from public.opportunities where id = p_opportunity and person_id = p_person and org_id = v_org) then raise exception 'oportunidade não pertence à pessoa'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'inclua ao menos um item'; end if;
  if p_idempotency_key is not null then
    if length(p_idempotency_key) > 200 then raise exception 'chave de idempotência muito longa'; end if;
    select * into v_prev from public.sales where org_id = v_org and idempotency_key = p_idempotency_key;
    if found then
      if v_prev.person_id <> p_person then raise exception 'chave de idempotência já usada por outra venda'; end if;
      return v_prev.id;                                                              -- mesma tentativa repetida: a mesma venda
    end if;
  end if;
  begin
    insert into public.sales (org_id, unit_id, person_id, opportunity_id, discount_cents, installments, first_due, notes, created_by, idempotency_key)
      values (v_org, p_unit, p_person, p_opportunity, greatest(coalesce(p_discount_cents, 0), 0), p_installments, coalesce(p_first_due, current_date), p_notes, (select auth.uid()), p_idempotency_key) returning id into v_id;
  exception when unique_violation then
    if p_idempotency_key is not null then                                            -- corrida entre duas chamadas com a mesma chave: a perdedora devolve a venda da vencedora
      select * into v_prev from public.sales where org_id = v_org and idempotency_key = p_idempotency_key;
      if found and v_prev.person_id = p_person then return v_prev.id; end if;
    end if;
    raise exception 'já existe uma venda pendente para esta oportunidade: confirme ou cancele essa venda antes de criar outra';
  end;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (it ->> 'product_id')::uuid and org_id = v_org and active;
    if not found then raise exception 'produto inválido'; end if;
    v_price := coalesce((it ->> 'unit_price_cents')::bigint, pr.price_cents);
    insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents, discount_cents)
      values (v_org, v_id, pr.id, pr.name, coalesce((it ->> 'qty')::int, 1), v_price, coalesce((it ->> 'discount_cents')::bigint, 0));
  end loop;
  if (select discount_cents from public.sales where id = v_id) > (select subtotal_cents from public.sales where id = v_id) then raise exception 'desconto maior que o subtotal'; end if;
  update public.sales set total_cents = greatest(subtotal_cents - discount_cents, 0) where id = v_id;
  return v_id;
end $$;
revoke all on function public.sale_create(uuid, uuid, uuid, jsonb, bigint, int, date, text, text) from public, anon;
grant execute on function public.sale_create(uuid, uuid, uuid, jsonb, bigint, int, date, text, text) to authenticated;

-- crm_create_opportunity (SECURITY INVOKER, como antes): só acrescenta a recusa de duplicidade aberta no mesmo funil
create or replace function public.crm_create_opportunity(
  p_person_id uuid, p_pipeline_id uuid, p_unit_id uuid, p_title text,
  p_product_id uuid default null, p_value_cents bigint default 0, p_owner uuid default null,
  p_source text default null, p_campaign text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid := private.current_org(); v_stage uuid; v_id uuid; v_owner uuid;
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if exists (select 1 from public.opportunities where person_id = p_person_id and pipeline_id = p_pipeline_id and status = 'open') then
    raise exception 'já existe uma oportunidade aberta desta pessoa neste funil; abra a existente em vez de criar outra';
  end if;
  select id into v_stage from public.pipeline_stages where pipeline_id = p_pipeline_id and kind = 'open' order by position limit 1;
  if v_stage is null then raise exception 'funil sem etapas'; end if;
  v_owner := coalesce(p_owner, private.pick_owner(v_org, p_unit_id), (select auth.uid()));
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, product_id, title, value_cents, source, campaign, created_by)
  values (v_org, p_unit_id, p_person_id, p_pipeline_id, v_stage, v_owner, p_product_id, p_title, coalesce(p_value_cents, 0), p_source, p_campaign, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text) from public, anon;
grant execute on function public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text) to authenticated;
