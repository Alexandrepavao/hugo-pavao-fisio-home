-- HP Group Hub — 034 corporate_account_report(): appointments.period é tstzrange, não starts_at. Achado
-- escrevendo o teste (item B): o filtro de período usava uma coluna que não existe; corrigido para lower(period),
-- mesmo padrão já usado em dashboard_metrics/team_day/my_appointments.
create or replace function public.corporate_account_report(p_account uuid, p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.corporate_accounts; n int; v_attended int; v_billed bigint;
begin
  select * into a from public.corporate_accounts where id = p_account and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager', 'ops_admin', 'unit_manager', 'finance']::public.app_role[], a.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select count(*) into n from public.corporate_members where account_id = p_account;
  if n < 5 then return jsonb_build_object('members', n, 'available', false); end if;
  select count(*) into v_attended from public.appointments ap join public.corporate_members m on m.person_id = ap.person_id and m.account_id = p_account
    where ap.status = 'attended' and (p_from is null or lower(ap.period) >= p_from) and (p_to is null or lower(ap.period) < p_to);
  select coalesce(sum(p.amount_cents), 0) into v_billed from public.payments p join public.receivables r on r.id = p.receivable_id
    join public.corporate_members m on m.person_id = r.person_id and m.account_id = p_account
    where p.kind = 'payment' and (p_from is null or p.paid_at >= p_from) and (p_to is null or p.paid_at < p_to);
  return jsonb_build_object('members', n, 'available', true, 'attended_sessions', v_attended, 'billed_cents', v_billed);
end $$;

grant execute on function public.corporate_account_report(uuid, timestamptz, timestamptz) to authenticated;
