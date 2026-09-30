-- HP Group Hub — 052 Release v1: falta e comparecimento só depois do horário.
-- Achado na jornada de aceite: set_appointment_status já barrava "comparecimento futuro", mas permitia marcar
-- "falta" (no_show) ANTES do horário — o que consome sessão do pacote (produtos com consume_on_no_show) por uma
-- falta que ainda não aconteceu. Agora as duas marcações exigem que o atendimento já tenha começado.
-- Cancelamentos (do paciente ou da clínica) continuam possíveis a qualquer momento.
create or replace function public.set_appointment_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_schedule(a.unit_id, a.professional_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('confirmed','attended','no_show','cancelled_by_patient','cancelled_by_clinic') then raise exception 'status inválido'; end if;
  if a.status = p_status then return; end if;
  if a.status in ('rescheduled','cancelled_by_patient','cancelled_by_clinic') then raise exception 'agendamento encerrado'; end if;
  if a.status in ('attended') and p_status <> 'attended' then raise exception 'atendimento realizado só pode ser ajustado pelo saldo do pacote'; end if;
  if p_status = 'attended' and lower(a.period) > now() then raise exception 'não é possível marcar comparecimento futuro'; end if;
  if p_status = 'no_show' and lower(a.period) > now() then raise exception 'não é possível marcar falta antes do horário do atendimento'; end if;
  update public.appointments set status = p_status, cancel_reason = case when p_status like 'cancelled%' then p_reason end where id = p_id;
  if p_status <> 'confirmed' then
    perform private.emit_event(a.org_id, 'appointment.' || p_status, 'appointment', p_id, jsonb_build_object('at', now()), 'appt.' || p_status || ':' || p_id);
  end if;
end $$;
