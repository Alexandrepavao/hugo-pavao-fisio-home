-- Academy: a oportunidade de EDUCAÇÃO ia para a etapa final ("Acesso liberado") no PRIMEIRO recebimento, mesmo quando o produto só libera o acesso na QUITAÇÃO
-- (products.access_rule = 'on_full_payment'): o funil dizia "acesso liberado" enquanto o aluno ainda não tinha acesso. Agora a etapa final acompanha a regra de acesso configurada:
--   · algum item da venda exige quitação  → só avança quando não resta parcela em aberto;
--   · demais produtos (on_first_payment)  → continua avançando no primeiro recebimento (regra existente, inalterada).

create or replace function private.h_payment_opportunity(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; pay public.payments; s public.sales; v_kind text; v_full boolean; v_needs_full boolean;
begin
  select * into e from public.domain_events where id = p_event;
  select * into pay from public.payments where id = e.aggregate_id;
  select s2.* into s from public.sales s2 join public.receivables r on r.sale_id = s2.id where r.id = pay.receivable_id;
  if pay.kind <> 'payment' or s.opportunity_id is null then return; end if;
  select pl.kind into v_kind from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.id = s.opportunity_id;
  if v_kind = 'education' then
    v_needs_full := exists (select 1 from public.sale_items si join public.products p on p.id = si.product_id where si.sale_id = s.id and p.access_rule = 'on_full_payment');
    v_full := not exists (select 1 from public.receivables r where r.sale_id = s.id and r.status not in ('paid', 'cancelled'));
    if v_needs_full and not v_full then return; end if;
    update public.opportunities o set stage_id = st.id from public.pipeline_stages st
     where o.id = s.opportunity_id and st.pipeline_id = o.pipeline_id and st.kind = 'won' and o.status = 'open';
  end if;
end $$;
