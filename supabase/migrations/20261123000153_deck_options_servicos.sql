-- HP Group Hub — 153 Orçamento: o seletor de produto do documento passa a oferecer também SERVIÇOS com preço (cobrados por sessão), além dos pacotes.
-- Serviço avulso: a quantidade acompanha as sessões do plano inicial (recalcula quando o plano muda); pacote: quantidade de pacotes (padrão 1).
create or replace function public.deck_options(p_enrollment uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments;
begin
  e := private.presentation_can_edit(p_enrollment);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'price_cents', p.price_cents, 'sessions_count', p.sessions_count, 'validity_days', p.validity_days) order by p.kind, p.price_cents, p.name)
                     from public.products p where p.org_id = e.org_id and p.active and p.kind in ('package', 'service') and p.price_cents > 0), '[]'::jsonb);
end $$;
