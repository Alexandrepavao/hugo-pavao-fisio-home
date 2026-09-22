-- HP Group Hub — 022 Corrige public.mrr_history(): generate_series(date, date, interval) devolve timestamp,
-- não date puro — jsonb_build_object serializava "2026-07-01T00:00:00+00:00", que o front concatenava com
-- outra hora ("...+00:00T12:00:00Z") e virava Invalid Date no gráfico. Mesmo padrão de cast já usado em
-- cash_flow_monthly (m::date).
create or replace function public.mrr_history(p_months int default 12, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); v_from date := date_trunc('month', current_date - (p_months - 1) * interval '1 month')::date;
begin
  return coalesce((select jsonb_agg(jsonb_build_object('month', m::date, 'mrr_cents', coalesce(t.total, 0)) order by m)
    from generate_series(v_from, date_trunc('month', current_date)::date, interval '1 month') m
    left join lateral (select sum(amount_cents) as total from private.mrr_base(m::date) where unit_id = any (u)) t on true), '[]');
end $$;

grant execute on function public.mrr_history(int, uuid) to authenticated;
