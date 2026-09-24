-- HP Group Hub — 041 Amplia dashboard_card_detail(): os 6 exemplos da etapa anterior não limitavam o
-- escopo. Acrescenta mais 15 tipos de cartão (Início, Financeiro › Visão geral, Financeiro › Recorrência),
-- sempre reconciliando com a mesma tabela/filtro/escopo de unidade já usado pela métrica original
-- (dashboard_metrics/dashboard_alerts/mrr_report). CREATE OR REPLACE mantém os 6 tipos da migration 039.
create or replace function public.dashboard_card_detail(p_kind text, p_from timestamptz, p_to timestamptz, p_unit uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_org uuid := private.current_org();
  v_items jsonb; v_total int; v_value numeric; v_available boolean; v_basis text; v_is_snapshot boolean := false; v_label text; v_route text;
begin
  if p_kind = 'receipts' then
    v_label := 'Recebimentos'; v_route := '/admin/financeiro/vendas'; v_basis := 'recebimentos efetivos líquidos de estornos (data do pagamento)';
    select coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end), 0), count(*) into v_value, v_total
      from public.payments p where p.unit_id = any (u) and p.paid_at >= p_from and p.paid_at < p_to;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.method,
        'amount_cents', x.signed_cents, 'date', x.paid_at, 'tag', x.kind) order by x.paid_at desc), '[]')
      into v_items
      from (select p.id, r.person_id, p.method, case p.kind when 'payment' then p.amount_cents else -p.amount_cents end as signed_cents, p.paid_at, p.kind
              from public.payments p join public.receivables r on r.id = p.receivable_id
             where p.unit_id = any (u) and p.paid_at >= p_from and p.paid_at < p_to
             order by p.paid_at desc limit 20) x;

  elsif p_kind = 'overdue' then
    v_label := 'Contas vencidas'; v_route := '/admin/financeiro/vendas'; v_is_snapshot := true;
    v_basis := 'saldo de parcelas vencidas e não pagas (situação de hoje — não muda com o período selecionado)';
    select coalesce(sum(r.amount_cents - private.receivable_net(r.id)), 0), count(*) into v_value, v_total
      from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', 'Parcela ' || x.installment_no || '/' || x.installments_total,
        'amount_cents', x.amount_cents - private.receivable_net(x.id), 'date', x.due_date, 'tag', (current_date - x.due_date) || ' dia(s) de atraso') order by x.due_date), '[]')
      into v_items
      from (select * from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date order by r.due_date limit 20) x;

  elsif p_kind = 'new_patients' then
    v_label := 'Novos pacientes'; v_route := '/admin/pessoas'; v_basis := 'pessoas com o tipo "paciente" cadastradas no período (data de criação do cadastro)';
    select count(*) into v_value from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = 'patient'
      where p.unit_id = any (u) and p.created_at >= p_from and p.created_at < p_to;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.full_name, 'subtitle', coalesce(x.city, 'cidade não informada'), 'date', x.created_at) order by x.created_at desc), '[]')
      into v_items
      from (select p.id, p.full_name, p.city, p.created_at from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = 'patient'
              where p.unit_id = any (u) and p.created_at >= p_from and p.created_at < p_to order by p.created_at desc limit 20) x;

  elsif p_kind = 'evaluations_scheduled' then
    v_label := 'Avaliações agendadas'; v_route := '/admin/agenda'; v_basis := 'agendamentos originados de oportunidades (data da criação do agendamento)';
    select count(*) into v_value from public.appointments a where a.unit_id = any (u) and a.created_at >= p_from and a.created_at < p_to and a.opportunity_id is not null;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', coalesce(pr.display_name, 'sem profissional'),
        'date', lower(x.period), 'tag', x.status) order by x.created_at desc), '[]')
      into v_items
      from (select * from public.appointments a where a.unit_id = any (u) and a.created_at >= p_from and a.created_at < p_to and a.opportunity_id is not null order by a.created_at desc limit 20) x
      left join public.professionals pr on pr.id = x.professional_id;

  elsif p_kind = 'win_rate' then
    v_label := 'Conversão comercial'; v_route := '/admin/crm'; v_basis := 'ganhas ÷ (ganhas+perdidas) fechadas no período (%)';
    declare v_won int; v_lost int; begin
      select count(*) filter (where status = 'won'), count(*) filter (where status = 'lost') into v_won, v_lost
        from public.opportunities where unit_id = any (u) and closed_at >= p_from and closed_at < p_to;
      v_available := (v_won + v_lost) > 0;
      v_value := case when v_available then round(v_won * 100.0 / (v_won + v_lost), 1) end;
      v_total := v_won + v_lost;
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title,
          'amount_cents', x.value_cents, 'date', x.closed_at, 'tag', case x.status when 'won' then 'Ganha' else 'Perdida' end) order by x.closed_at desc), '[]')
        into v_items
        from (select * from public.opportunities where unit_id = any (u) and status in ('won','lost') and closed_at >= p_from and closed_at < p_to order by closed_at desc limit 20) x;
    end;

  elsif p_kind = 'overdue_tasks' then
    v_label := 'Tarefas atrasadas'; v_route := '/admin/crm'; v_is_snapshot := true;
    v_basis := 'tarefas comerciais não concluídas com vencimento no passado (situação de agora — não muda com o período selecionado)';
    select count(*) into v_value from public.crm_tasks t where t.unit_id = any (u) and t.done_at is null and t.due_at < now();
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'subtitle', coalesce(private.dcd_person_name(x.person_id), 'sem pessoa vinculada'),
        'date', x.due_at, 'tag', extract(day from now() - x.due_at)::int || ' dia(s) de atraso') order by x.due_at), '[]')
      into v_items
      from (select * from public.crm_tasks t where t.unit_id = any (u) and t.done_at is null and t.due_at < now() order by t.due_at limit 20) x;

  -- ---------------------------------------------------------------- novos (migration 041)
  elsif p_kind = 'attended' then
    v_label := 'Atendimentos realizados'; v_route := '/admin/agenda'; v_basis := 'atendimentos realizados (data do atendimento)';
    select count(*) into v_value from public.appointments a where a.unit_id = any (u) and a.status = 'attended' and lower(a.period) >= p_from and lower(a.period) < p_to;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', coalesce(pr.display_name, 'sem profissional'), 'date', lower(x.period)) order by x.period desc), '[]')
      into v_items
      from (select * from public.appointments a where a.unit_id = any (u) and a.status = 'attended' and lower(a.period) >= p_from and lower(a.period) < p_to order by a.period desc limit 20) x
      left join public.professionals pr on pr.id = x.professional_id;

  elsif p_kind = 'active_students' then
    v_label := 'Alunos ativos no Academy'; v_route := '/admin/academy'; v_basis := 'pessoas com acesso ativo a algum curso/mentoria (hoje)'; v_is_snapshot := true;
    select count(distinct e.person_id) into v_value from public.entitlements e where e.org_id = v_org and e.revoked_at is null and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now());
    v_available := true;
    select count(*) into v_total from public.entitlements e where e.org_id = v_org and e.revoked_at is null and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now());
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', c.title, 'date', x.valid_from) order by x.valid_from desc), '[]')
      into v_items
      from (select * from public.entitlements e where e.org_id = v_org and e.revoked_at is null and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now()) order by e.valid_from desc limit 20) x
      join public.courses c on c.id = x.course_id;

  elsif p_kind = 'average_ticket' then
    v_label := 'Ticket médio'; v_route := '/admin/financeiro/vendas'; v_basis := 'média do total das vendas confirmadas (data da venda)';
    select round(avg(s.total_cents), 0), count(*) into v_value, v_total from public.sales s where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to;
    v_available := v_value is not null;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'amount_cents', x.total_cents, 'date', x.sold_at) order by x.sold_at desc), '[]')
      into v_items
      from (select * from public.sales s where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to order by s.sold_at desc limit 20) x;

  elsif p_kind = 'attendance_rate' then
    v_label := 'Comparecimento'; v_route := '/admin/agenda'; v_basis := 'comparecimento ÷ (comparecimento+faltas) (%)';
    declare v_att int; v_ns int; begin
      select count(*) filter (where status = 'attended'), count(*) filter (where status = 'no_show') into v_att, v_ns
        from public.appointments where unit_id = any (u) and lower(period) >= p_from and lower(period) < p_to;
      v_available := (v_att + v_ns) > 0;
      v_value := case when v_available then round(v_att * 100.0 / (v_att + v_ns), 1) end;
      v_total := v_att + v_ns;
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'date', lower(x.period), 'tag', case x.status when 'attended' then 'Compareceu' else 'Faltou' end) order by x.period desc), '[]')
        into v_items
        from (select * from public.appointments where unit_id = any (u) and status in ('attended','no_show') and lower(period) >= p_from and lower(period) < p_to order by period desc limit 20) x;
    end;

  elsif p_kind = 'sales_confirmed' then
    v_label := 'Vendas confirmadas'; v_route := '/admin/financeiro/vendas'; v_basis := 'quantidade de vendas confirmadas no período (data da venda)';
    select count(*) into v_value from public.sales s where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'amount_cents', x.total_cents, 'date', x.sold_at) order by x.sold_at desc), '[]')
      into v_items
      from (select * from public.sales s where s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to order by s.sold_at desc limit 20) x;

  elsif p_kind = 'forecast_receivables_30d' then
    v_label := 'Contas a receber (30 dias)'; v_route := '/admin/financeiro/vendas'; v_is_snapshot := true;
    v_basis := 'parcelas contratadas a vencer nos próximos 30 dias (situação de hoje — não muda com o período selecionado)';
    select coalesce(sum(r.amount_cents - private.receivable_net(r.id)), 0), count(*) into v_value, v_total
      from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date >= current_date and r.due_date < current_date + 30;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', 'Parcela ' || x.installment_no || '/' || x.installments_total, 'amount_cents', x.amount_cents - private.receivable_net(x.id), 'date', x.due_date) order by x.due_date), '[]')
      into v_items
      from (select * from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date >= current_date and r.due_date < current_date + 30 order by r.due_date limit 20) x;

  elsif p_kind = 'forecast_payables_30d' then
    v_label := 'Contas a pagar (30 dias)'; v_route := '/admin/financeiro/pagar'; v_is_snapshot := true;
    v_basis := 'contas a pagar em aberto com vencimento até 30 dias (situação de hoje — não muda com o período selecionado)';
    select coalesce(sum(amount_cents), 0), count(*) into v_value, v_total from public.payables where unit_id = any (u) and status = 'open' and due_date < current_date + 30;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.description, 'amount_cents', x.amount_cents, 'date', x.due_date) order by x.due_date), '[]')
      into v_items
      from (select * from public.payables where unit_id = any (u) and status = 'open' and due_date < current_date + 30 order by due_date limit 20) x;

  elsif p_kind = 'cash_result' then
    v_label := 'Resultado de caixa'; v_route := '/admin/financeiro/fluxo-caixa'; v_basis := 'recebimentos − despesas pagas no período (regime de caixa)';
    declare v_in bigint; v_out bigint; begin
      declare v_n_pay int; v_n_bill int; begin
        select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0), count(*) into v_in, v_n_pay from public.payments where unit_id = any (u) and paid_at >= p_from and paid_at < p_to;
        select coalesce(sum(amount_cents), 0), count(*) into v_out, v_n_bill from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to;
        v_total := v_n_pay + v_n_bill;
      end;
      v_value := v_in - v_out; v_available := true;
      select coalesce(jsonb_agg(x.o order by x.d desc), '[]') into v_items from (
        (select jsonb_build_object('id', p.id, 'title', private.dcd_person_name(r.person_id), 'subtitle', 'Recebimento', 'amount_cents', case p.kind when 'payment' then p.amount_cents else -p.amount_cents end, 'date', p.paid_at) as o, p.paid_at as d
           from public.payments p join public.receivables r on r.id = p.receivable_id where p.unit_id = any (u) and p.paid_at >= p_from and p.paid_at < p_to order by p.paid_at desc limit 10)
        union all
        (select jsonb_build_object('id', b.id, 'title', b.description, 'subtitle', 'Conta paga', 'amount_cents', -b.amount_cents, 'date', b.paid_at) as o, b.paid_at as d
           from public.payables b where b.unit_id = any (u) and b.status = 'paid' and b.paid_at >= p_from and b.paid_at < p_to order by b.paid_at desc limit 10)
      ) x;
    end;

  -- ---------------------------------------------------------------- alertas do Início (migration 041)
  elsif p_kind = 'leads_sem_retorno' then
    v_label := 'Leads sem retorno há mais de 48h'; v_route := '/admin/crm?filtro=sem-retorno'; v_is_snapshot := true;
    v_basis := 'oportunidades abertas sem contato há mais de 48h (situação de agora)';
    select count(*) into v_value from public.opportunities where unit_id = any (u) and status = 'open' and coalesce(last_contact_at, created_at) < now() - interval '48 hours';
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'date', coalesce(x.last_contact_at, x.created_at)) order by coalesce(x.last_contact_at, x.created_at)), '[]')
      into v_items
      from (select * from public.opportunities where unit_id = any (u) and status = 'open' and coalesce(last_contact_at, created_at) < now() - interval '48 hours' order by coalesce(last_contact_at, created_at) limit 20) x;

  elsif p_kind = 'pacotes_fim' then
    v_label := 'Pacotes ativos com 2 sessões ou menos'; v_route := '/admin/agenda'; v_is_snapshot := true;
    v_basis := 'pacotes ativos com saldo de sessões ≤ 2 (situação de agora)';
    select count(*) into v_value from public.client_packages c where c.unit_id = any (u) and c.status = 'active' and private.package_balance(c.id) <= 2;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', pr.name, 'tag', private.package_balance(x.id) || ' sessão(ões) restante(s)', 'date', x.created_at) order by x.created_at desc), '[]')
      into v_items
      from (select * from public.client_packages c where c.unit_id = any (u) and c.status = 'active' and private.package_balance(c.id) <= 2 order by c.created_at desc limit 20) x
      join public.products pr on pr.id = x.product_id;

  elsif p_kind = 'duplicidades' then
    v_label := 'Possíveis duplicidades para revisar'; v_route := '/admin/crm'; v_is_snapshot := true;
    v_basis := 'tarefas de revisão de duplicidade/contato compartilhado ainda pendentes (situação de agora)';
    select count(*) into v_value from public.crm_tasks t where t.unit_id = any (u) and t.done_at is null and t.kind = 'dedupe_review';
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'subtitle', coalesce(private.dcd_person_name(x.person_id), 'sem pessoa vinculada'), 'date', x.created_at) order by x.created_at desc), '[]')
      into v_items
      from (select * from public.crm_tasks t where t.unit_id = any (u) and t.done_at is null and t.kind = 'dedupe_review' order by t.created_at desc limit 20) x;

  elsif p_kind = 'eventos_falhos' then
    v_label := 'Automações com falha'; v_route := '/admin/auditoria'; v_is_snapshot := true;
    v_basis := 'eventos de automação com falha definitiva ou tentativas esgotadas (situação de agora)';
    if not private.is_manager() then raise exception 'sem permissão' using errcode = '42501'; end if;
    select count(*) into v_value from public.domain_events where org_id = v_org and status in ('failed','dead');
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.type, 'subtitle', left(coalesce(x.last_error, 'sem detalhe'), 120), 'date', x.created_at, 'tag', x.status) order by x.created_at desc), '[]')
      into v_items
      from (select * from public.domain_events where org_id = v_org and status in ('failed','dead') order by created_at desc limit 20) x;

  -- ---------------------------------------------------------------- Financeiro › Recorrência (migration 041)
  -- O mês de referência é o mês de p_from (mesmo parâmetro que a página de Recorrência já usa em mrr_report(p_month, ...)) —
  -- assim o detalhamento respeita o seletor de mês da tela, em vez de sempre olhar para o mês corrente.
  elsif p_kind = 'mrr_month' then
    v_label := 'MRR do mês'; v_route := '/admin/financeiro/recorrencia';
    v_basis := 'soma dos contratos recorrentes ativos no mês selecionado';
    select coalesce(sum(amount_cents), 0), count(*) into v_value, v_total from private.mrr_base(date_trunc('month', p_from)::date) where unit_id = any (u);
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.contract_id, 'title', private.dcd_person_name(x.person_id), 'subtitle', pr.name, 'amount_cents', x.amount_cents) order by x.amount_cents desc), '[]')
      into v_items
      from (select * from private.mrr_base(date_trunc('month', p_from)::date) where unit_id = any (u) order by amount_cents desc limit 20) x
      join public.products pr on pr.id = x.product_id;

  elsif p_kind = 'recurring_clients' then
    v_label := 'Clientes recorrentes'; v_route := '/admin/financeiro/recorrencia';
    v_basis := 'pessoas com ao menos um contrato recorrente ativo no mês selecionado';
    select count(distinct person_id) into v_value from private.mrr_base(date_trunc('month', p_from)::date) where unit_id = any (u);
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.person_id, 'title', private.dcd_person_name(x.person_id), 'amount_cents', x.total) order by x.total desc), '[]')
      into v_items
      from (select person_id, sum(amount_cents) as total from private.mrr_base(date_trunc('month', p_from)::date) where unit_id = any (u) group by person_id order by sum(amount_cents) desc limit 20) x;

  elsif p_kind = 'churn_clients' then
    v_label := 'Churn de clientes'; v_route := '/admin/financeiro/recorrencia';
    v_basis := 'contratos recorrentes ativos no mês anterior ao selecionado que não seguem ativos no mês selecionado';
    select count(*) into v_total from private.mrr_base((date_trunc('month', p_from) - interval '1 month')::date) p
      where p.unit_id = any (u) and not exists (select 1 from private.mrr_base(date_trunc('month', p_from)::date) c where c.contract_id = p.contract_id);
    v_value := v_total; v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.contract_id, 'title', private.dcd_person_name(x.person_id), 'subtitle', pr.name, 'amount_cents', x.amount_cents) order by x.amount_cents desc), '[]')
      into v_items
      from (select p.* from private.mrr_base((date_trunc('month', p_from) - interval '1 month')::date) p
             where p.unit_id = any (u) and not exists (select 1 from private.mrr_base(date_trunc('month', p_from)::date) c where c.contract_id = p.contract_id) limit 20) x
      join public.products pr on pr.id = x.product_id;

  -- ---------------------------------------------------------------- Início: cartões restantes (migration 041)
  elsif p_kind = 'active_packages' then
    v_label := 'Pacientes com pacote ativo'; v_route := '/admin/agenda'; v_is_snapshot := true;
    v_basis := 'pessoas com ao menos um pacote em status ativo (situação de agora)';
    select count(distinct person_id) into v_value from public.client_packages where unit_id = any (u) and status = 'active';
    v_available := true;
    select count(*) into v_total from public.client_packages where unit_id = any (u) and status = 'active';
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', pr.name, 'tag', private.package_balance(x.id) || ' sessão(ões) restante(s)', 'date', x.created_at) order by x.created_at desc), '[]')
      into v_items
      from (select * from public.client_packages where unit_id = any (u) and status = 'active' order by created_at desc limit 20) x
      join public.products pr on pr.id = x.product_id;

  elsif p_kind = 'active_partners' then
    v_label := 'Parceiros ativos'; v_route := '/admin/parceiros'; v_is_snapshot := true;
    v_basis := 'perfis de parceiro com status ativo (situação de agora)';
    select count(*) into v_value from public.partner_profiles where unit_id = any (u) and status = 'active';
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.person_id, 'title', private.dcd_person_name(x.person_id), 'subtitle', coalesce(x.specialty, 'sem especialidade informada'), 'date', coalesce(x.approved_at, x.created_at)) order by coalesce(x.approved_at, x.created_at) desc), '[]')
      into v_items
      from (select * from public.partner_profiles where unit_id = any (u) and status = 'active' order by coalesce(approved_at, created_at) desc limit 20) x;

  else
    raise exception 'tipo de detalhamento desconhecido: %', p_kind;
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'label', v_label, 'value', v_value, 'available', v_available, 'basis', v_basis,
    'is_current_snapshot', v_is_snapshot, 'period', jsonb_build_object('from', p_from, 'to', p_to),
    'items', v_items, 'total_items', v_total, 'list_route', v_route
  );
end $$;
