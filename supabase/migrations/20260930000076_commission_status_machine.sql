-- Comissões: máquina de estados estrita e auditoria. Antes, commission_set_status aceitava pular a autorização (pendente → pago) e voltar atrás (pago → autorizado), e a mudança de
-- estado não deixava rastro de quem autorizou/pagou. Agora só pendente → autorizado e autorizado → pago; estornado e pago são finais; toda mudança é auditada.

create or replace function public.commission_set_status(p_entry uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.commission_entries;
begin
  select * into c from public.commission_entries where id = p_entry and org_id = private.current_org() for update;
  if not found or not private.can_finance(c.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('authorized','paid') then raise exception 'transição inválida'; end if;
  if c.status = p_status then return; end if;                                        -- repetir o mesmo clique não muda nada
  if not ((c.status = 'pending' and p_status = 'authorized') or (c.status = 'authorized' and p_status = 'paid')) then
    raise exception 'transição inválida: % → % (o fluxo é pendente → autorizado → pago; estornado e pago são finais)', c.status, p_status;
  end if;
  update public.commission_entries set status = p_status where id = p_entry;
end $$;
revoke all on function public.commission_set_status(uuid, text) from public, anon;
grant execute on function public.commission_set_status(uuid, text) to authenticated;

drop trigger if exists audit_commission_entries on public.commission_entries;
create trigger audit_commission_entries after update on public.commission_entries for each row execute function private.audit_row('status','amount_cents','percent_bp');
