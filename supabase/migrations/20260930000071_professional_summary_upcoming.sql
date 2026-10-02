-- my_professional_summary: “Agendados” passa a contar TODOS os atendimentos futuros (agendados/confirmados, a partir de agora), independente do período filtrado.
-- Antes só contava dentro do período e, como os períodos terminam hoje, nunca mostrava consultas futuras. Os demais números continuam limitados ao período.

create or replace function public.my_professional_summary(p_from date default null, p_to date default null, p_professional uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); pr public.professionals; v_from date := coalesce(p_from, date_trunc('month', now())::date); v_to date := coalesce(p_to, current_date);
        v_counts jsonb; v_self boolean; v_rules int; v_ent jsonb; v_auth bigint := 0; v_paid bigint := 0; v_any boolean := false;
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_to < v_from or v_to - v_from > 731 then raise exception 'período inválido (máximo de 2 anos)'; end if;
  if p_professional is null then select * into pr from public.professionals where user_id = v_uid and org_id = v_org; else select * into pr from public.professionals where id = p_professional and org_id = v_org; end if;
  if not found then raise exception 'perfil profissional não encontrado' using errcode = 'P0002'; end if;
  v_self := pr.user_id = v_uid;
  if not v_self and not private.can_view_prof_agenda(pr.id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object(
    'awaiting_record', count(*) filter (where b.status in ('scheduled','confirmed') and lower(b.period) <= now()),
    'attended', count(*) filter (where b.status = 'attended'),
    'cancelled_by_patient', count(*) filter (where b.status = 'cancelled_by_patient'),
    'cancelled_by_clinic', count(*) filter (where b.status = 'cancelled_by_clinic'),
    'rescheduled', count(*) filter (where b.status = 'rescheduled'),
    'patient_no_show', count(*) filter (where b.status = 'no_show'),
    'professional_no_show', count(*) filter (where b.status = 'professional_no_show'),
    'patients_attended', count(distinct b.person_id) filter (where b.status = 'attended'),
    'total', count(*)) into v_counts
  from public.appointments b join public.units u on u.id = b.unit_id
  where b.professional_id = pr.id and b.org_id = v_org and (lower(b.period) at time zone u.timezone)::date between v_from and v_to
    and (v_self or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], b.unit_id));
  v_counts := v_counts || jsonb_build_object('scheduled', (select count(*) from public.appointments b
      where b.professional_id = pr.id and b.org_id = v_org and b.status in ('scheduled','confirmed') and lower(b.period) > now()
        and (v_self or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], b.unit_id))));
  if v_self and pr.user_id is not null then
    select count(*) into v_rules from public.commission_rules where org_id = v_org and active and beneficiary_user_id = pr.user_id;
    select coalesce(sum(amount_cents) filter (where status = 'authorized'), 0), coalesce(sum(amount_cents) filter (where status = 'paid'), 0), count(*) > 0 into v_auth, v_paid, v_any
      from public.commission_entries where beneficiary_user_id = pr.user_id and status in ('authorized','paid') and (created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
    select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'amount_cents', amount_cents, 'status', status) order by created_at desc), '[]') into v_ent
      from (select created_at, amount_cents, status from public.commission_entries where beneficiary_user_id = pr.user_id and status in ('authorized','paid')
              and (created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to order by created_at desc limit 20) x;
  end if;
  return jsonb_build_object('professional_id', pr.id, 'professional_name', pr.display_name, 'is_self', v_self, 'from', v_from, 'to', v_to, 'counts', v_counts,
    'payouts', case when not v_self then jsonb_build_object('visible', false, 'basis', 'repasses só aparecem para o próprio profissional')
                    else jsonb_build_object('visible', true, 'rules', coalesce(v_rules, 0), 'authorized_cents', v_auth, 'paid_cents', v_paid, 'entries', coalesce(v_ent, '[]'::jsonb),
                           'available', (coalesce(v_rules, 0) > 0 or v_any),
                           'basis', case when coalesce(v_rules, 0) = 0 and not v_any then 'nenhuma regra de repasse cadastrada para você e nenhum repasse autorizado ou pago no período'
                                         else 'repasses AUTORIZADOS e PAGOS gerados pelas regras de comissão em seu nome (pendentes de autorização não entram)' end) end);
end $$;

revoke all on function public.my_professional_summary(date, date, uuid) from public, anon;
grant execute on function public.my_professional_summary(date, date, uuid) to authenticated;
