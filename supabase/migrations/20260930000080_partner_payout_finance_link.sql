-- Repasses a PARCEIROS (decisão expressa do Financeiro, nunca automática por indicação): autorizar o repasse passa a registrar o COMPROMISSO em Contas a pagar (despesa em aberto, previsão) e marcar
-- como pago fecha essa mesma conta (caixa/DRE) — antes o repasse pago ficava só na tela de Parceiros e não aparecia no fluxo de caixa, na DRE nem nas despesas. Um repasse = uma conta (vínculo
-- `payable_id`); repetir o mesmo clique não duplica; cancelar antes de pagar cancela a conta. A linha de negócio fica "Não classificado" (visível nos totais) até o Financeiro classificar.

alter table public.partner_payouts add column if not exists payable_id uuid references public.payables(id) on delete set null;
create unique index if not exists partner_payouts_payable_uq on public.partner_payouts (payable_id) where payable_id is not null;

create or replace function public.payout_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.partner_payouts; v_name text; v_pay uuid;
begin
  select * into p from public.partner_payouts where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_finance(p.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p.status = p_status then return; end if;                                          -- repetir o mesmo clique não muda nada
  select full_name into v_name from public.people where id = p.partner_person_id;
  if p_status = 'authorized' and p.status = 'pending' then
    insert into public.payables (org_id, unit_id, description, supplier, amount_cents, due_date, competence_month, created_by)
      values (p.org_id, p.unit_id, 'Repasse a parceiro: ' || p.description, v_name, p.amount_cents, current_date, p.reference_month, (select auth.uid())) returning id into v_pay;
    update public.partner_payouts set status = 'authorized', authorized_by = (select auth.uid()), payable_id = v_pay where id = p_id;
  elsif p_status = 'paid' and p.status = 'authorized' then
    if p.payable_id is null then                                                         -- repasse autorizado ANTES desta migration: cria a conta já paga (uma só)
      insert into public.payables (org_id, unit_id, description, supplier, amount_cents, due_date, competence_month, status, paid_at, created_by)
        values (p.org_id, p.unit_id, 'Repasse a parceiro: ' || p.description, v_name, p.amount_cents, current_date, p.reference_month, 'paid', now(), (select auth.uid())) returning id into v_pay;
      update public.partner_payouts set status = 'paid', paid_at = now(), payable_id = v_pay where id = p_id;
    else
      update public.partner_payouts set status = 'paid', paid_at = now() where id = p_id;
      update public.payables set status = 'paid', paid_at = now() where id = p.payable_id and status = 'open';
    end if;
  elsif p_status = 'cancelled' and p.status in ('pending','authorized') then
    update public.partner_payouts set status = 'cancelled' where id = p_id;
    update public.payables set status = 'cancelled' where id = p.payable_id and status = 'open';
  else raise exception 'transição inválida (% -> %)', p.status, p_status; end if;
end $$;
revoke all on function public.payout_set_status(uuid, text) from public, anon;
grant execute on function public.payout_set_status(uuid, text) to authenticated;
