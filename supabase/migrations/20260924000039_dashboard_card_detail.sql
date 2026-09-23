-- HP Group Hub — 039 Detalhamento de cartões do dashboard/financeiro (painel lateral "Ver detalhes").
-- Uma função por "família" de cartão, todas atrás do mesmo guarda-chuva (dashboard_card_detail), reaproveitando
-- private.dash_units() (mesma checagem de permissão/escopo por unidade já usada em dashboard_metrics/alerts) —
-- o detalhamento nunca vê mais dado do que o próprio cartão já mostra. Cada resposta reconcilia com o valor do
-- cartão (mesmas tabelas, mesmo filtro de data/unidade). "hoje"/situação atual é sinalizado explicitamente.

create or replace function private.dcd_person_name(p_person uuid) returns text
language sql stable set search_path = '' as $$ select full_name from public.people where id = p_person $$;

create or replace function public.dashboard_card_detail(p_kind text, p_from timestamptz, p_to timestamptz, p_unit uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_items jsonb; v_total int; v_value numeric; v_available boolean; v_basis text; v_is_snapshot boolean := false; v_label text; v_route text;
begin
  if p_kind = 'receipts' then
    v_label := 'Recebimentos'; v_route := '/admin/financeiro/vendas'; v_basis := 'recebimentos efetivos líquidos de estornos (data do pagamento)';
    select coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end), 0) into v_value
      from public.payments p where p.unit_id = any (u) and p.paid_at >= p_from and p.paid_at < p_to;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.method,
        'amount_cents', x.signed_cents, 'date', x.paid_at, 'tag', x.kind) order by x.paid_at desc), '[]'), count(*)
      into v_items, v_total
      from (select p.id, r.person_id, p.method, case p.kind when 'payment' then p.amount_cents else -p.amount_cents end as signed_cents, p.paid_at, p.kind
              from public.payments p join public.receivables r on r.id = p.receivable_id
             where p.unit_id = any (u) and p.paid_at >= p_from and p.paid_at < p_to
             order by p.paid_at desc limit 20) x;

  elsif p_kind = 'overdue' then
    v_label := 'Contas vencidas'; v_route := '/admin/financeiro/vendas'; v_is_snapshot := true;
    v_basis := 'saldo de parcelas vencidas e não pagas (situação de hoje — não muda com o período selecionado)';
    select coalesce(sum(r.amount_cents - private.receivable_net(r.id)), 0) into v_value
      from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', 'Parcela ' || x.installment_no || '/' || x.installments_total,
        'amount_cents', x.amount_cents - private.receivable_net(x.id), 'date', x.due_date, 'tag', (current_date - x.due_date) || ' dia(s) de atraso') order by x.due_date), '[]'), count(*)
      into v_items, v_total
      from (select * from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date order by r.due_date limit 20) x;

  elsif p_kind = 'new_patients' then
    v_label := 'Novos pacientes'; v_route := '/admin/pessoas'; v_basis := 'pessoas com o tipo "paciente" cadastradas no período (data de criação do cadastro)';
    select count(*) into v_value from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = 'patient'
      where p.unit_id = any (u) and p.created_at >= p_from and p.created_at < p_to;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.full_name, 'subtitle', coalesce(x.city, 'cidade não informada'), 'date', x.created_at) order by x.created_at desc), '[]'), count(*)
      into v_items, v_total
      from (select p.id, p.full_name, p.city, p.created_at from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = 'patient'
              where p.unit_id = any (u) and p.created_at >= p_from and p.created_at < p_to order by p.created_at desc limit 20) x;

  elsif p_kind = 'evaluations_scheduled' then
    v_label := 'Avaliações agendadas'; v_route := '/admin/agenda'; v_basis := 'agendamentos originados de oportunidades (data da criação do agendamento)';
    select count(*) into v_value from public.appointments a where a.unit_id = any (u) and a.created_at >= p_from and a.created_at < p_to and a.opportunity_id is not null;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', coalesce(pr.display_name, 'sem profissional'),
        'date', lower(x.period), 'tag', x.status) order by x.created_at desc), '[]'), count(*)
      into v_items, v_total
      from (select * from public.appointments a where a.unit_id = any (u) and a.created_at >= p_from and a.created_at < p_to and a.opportunity_id is not null order by a.created_at desc limit 20) x
      left join public.professionals pr on pr.id = x.professional_id;

  elsif p_kind = 'win_rate' then
    v_label := 'Conversão comercial'; v_route := '/admin/crm'; v_basis := 'ganhas ÷ (ganhas+perdidas) fechadas no período (%)';
    declare v_won int; v_lost int; begin
      select count(*) filter (where status = 'won'), count(*) filter (where status = 'lost') into v_won, v_lost
        from public.opportunities where unit_id = any (u) and closed_at >= p_from and closed_at < p_to;
      v_available := (v_won + v_lost) > 0;
      v_value := case when v_available then round(v_won * 100.0 / (v_won + v_lost), 1) end;
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title,
          'amount_cents', x.value_cents, 'date', x.closed_at, 'tag', case x.status when 'won' then 'Ganha' else 'Perdida' end) order by x.closed_at desc), '[]'), count(*)
        into v_items, v_total
        from (select * from public.opportunities where unit_id = any (u) and status in ('won','lost') and closed_at >= p_from and closed_at < p_to order by closed_at desc limit 20) x;
    end;

  elsif p_kind = 'overdue_tasks' then
    v_label := 'Tarefas atrasadas'; v_route := '/admin/crm'; v_is_snapshot := true;
    v_basis := 'tarefas comerciais não concluídas com vencimento no passado (situação de agora — não muda com o período selecionado)';
    select count(*) into v_value from public.crm_tasks t where t.unit_id = any (u) and t.done_at is null and t.due_at < now();
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'subtitle', coalesce(private.dcd_person_name(x.person_id), 'sem pessoa vinculada'),
        'date', x.due_at, 'tag', extract(day from now() - x.due_at)::int || ' dia(s) de atraso') order by x.due_at), '[]'), count(*)
      into v_items, v_total
      from (select * from public.crm_tasks t where t.unit_id = any (u) and t.done_at is null and t.due_at < now() order by t.due_at limit 20) x;

  else
    raise exception 'tipo de detalhamento desconhecido: %', p_kind;
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'label', v_label, 'value', v_value, 'available', v_available, 'basis', v_basis,
    'is_current_snapshot', v_is_snapshot, 'period', jsonb_build_object('from', p_from, 'to', p_to),
    'items', v_items, 'total_items', v_total, 'list_route', v_route
  );
end $$;

grant execute on function public.dashboard_card_detail(text, timestamptz, timestamptz, uuid) to authenticated;
