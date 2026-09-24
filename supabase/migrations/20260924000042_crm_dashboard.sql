-- HP Group Hub — 042 Dashboard comercial do CRM (app interno com sidebar/entrada próprias — ver App.tsx/nav).
-- Diferente de dashboard_metrics/dashboard_card_detail (que só manager/ops_admin/unit_manager/finance acessam):
-- este painel é PARA o comercial (papel "sales") ver os próprios números, então usa escopo próprio.

-- private.crm_units: como private.dash_units, mas inclui 'sales' no ramo de não-gestor (o dashboard comercial
-- é feito pra quem vende, não só pra quem gerencia).
create or replace function private.crm_units(p_unit uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v uuid[];
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
    select array_agg(id) into v from public.units where org_id = v_org and (p_unit is null or id = p_unit);
  else
    select array_agg(distinct ra.unit_id) into v from public.role_assignments ra
     where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','sales','finance']::public.app_role[]) and ra.unit_id is not null and ra.revoked_at is null
       and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit);
  end if;
  if v is null then raise exception 'sem permissão para o painel comercial' using errcode = '42501'; end if;
  return v;
end $$;

-- private.crm_is_team_viewer: quem pode ver o time inteiro (não só os próprios negócios) — manager/ops_admin
-- (org) ou unit_manager (em alguma unidade). private.has_unit_role(roles, null) só bate com atribuição SEM
-- unidade (org-wide), por isso a checagem de unit_manager aqui é direta em role_assignments.
create or replace function private.crm_is_team_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_org_role(array['manager','ops_admin']::public.app_role[])
    or exists (
      select 1 from public.role_assignments ra
      join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
      where ra.user_id = (select auth.uid()) and ra.role = 'unit_manager'
        and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
    )
$$;

-- private.crm_effective_owner: quem não vê o time (comercial comum) só enxerga os próprios negócios,
-- mesmo que tente passar p_owner de outra pessoa — o filtro de responsável na tela só serve pra quem gerencia.
create or replace function private.crm_effective_owner(p_owner uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when private.crm_is_team_viewer() then p_owner else (select auth.uid()) end
$$;

create or replace function public.crm_dashboard_metrics(p_from timestamptz, p_to timestamptz, p_unit uuid default null, p_owner uuid default null, p_pipeline uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.crm_units(p_unit);
  v_owner uuid := private.crm_effective_owner(p_owner);
  v_new_leads bigint; v_won bigint; v_lost bigint; v_open bigint; v_open_value bigint; v_total bigint; v_stale bigint;
  v_commission bigint; v_commission_available boolean; v_commission_n int;
begin
  -- novos leads no período: oportunidades CRIADAS no período (fluxo de entrada) — não confundir com
  -- "atualmente na primeira etapa" (isso é a fila de Gestão de leads, uma foto de agora, não um fluxo).
  select count(*) into v_new_leads from public.opportunities o
    where o.unit_id = any (u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline)
      and o.created_at >= p_from and o.created_at < p_to;

  select count(*) filter (where status = 'won' and closed_at >= p_from and closed_at < p_to),
         count(*) filter (where status = 'lost' and closed_at >= p_from and closed_at < p_to)
    into v_won, v_lost
    from public.opportunities o
    where o.unit_id = any (u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline);

  -- em aberto e valor em negociação: situação de agora (não muda com o período selecionado)
  select count(*), coalesce(sum(value_cents), 0) into v_open, v_open_value from public.opportunities o
    where o.unit_id = any (u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open';

  -- total de negócios no recorte: em aberto agora + fechados (ganhos/perdidos) no período — atividade da
  -- carteira durante a janela, diferente de "novos leads" (que é só quem entrou).
  v_total := v_open + v_won + v_lost;

  -- sem retorno: abertas, sem contato há mais de 48h (situação de agora)
  select count(*) into v_stale from public.opportunities o
    where o.unit_id = any (u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline)
      and o.status = 'open' and coalesce(o.last_contact_at, o.created_at) < now() - interval '48 hours';

  -- comissão potencial: só uma ESTIMATIVA sobre negócios em aberto, usando as regras de comissão já
  -- cadastradas (commission_rules) — nunca comissão adquirida/aprovada/paga (isso é commission_entries,
  -- gerado só sobre pagamento real). Sem regra aplicável = indisponível com o motivo real, nunca um número
  -- inventado. Prioriza regra específica do produto sobre a genérica (product_id null), e regra específica
  -- do responsável sobre a genérica (beneficiary_user_id null).
  with open_deals as (
    select o.id, o.value_cents, o.product_id, o.owner_user_id, o.unit_id
    from public.opportunities o
    where o.unit_id = any (u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open'
  ), matched as (
    select d.id, d.value_cents,
      (select r.percent_bp from public.commission_rules r
        where r.active and (r.product_id = d.product_id or r.product_id is null) and (r.beneficiary_user_id = d.owner_user_id or r.beneficiary_user_id is null)
        order by (r.product_id is not null) desc, (r.beneficiary_user_id is not null) desc limit 1) as percent_bp
    from open_deals d
  )
  select coalesce(sum(value_cents * percent_bp / 10000.0), 0)::bigint, count(*) filter (where percent_bp is not null)
    into v_commission, v_commission_n
    from matched;
  -- conta quantos negócios têm alguma regra aplicável; disponível só se houver ao menos 1
  v_commission_available := v_commission_n > 0;

  return jsonb_build_object(
    'new_leads', private.metric(v_new_leads, true, 'oportunidades criadas no período (fluxo de entrada — não é a fila da primeira etapa)'),
    'total_deals', private.metric(v_total, true, 'em aberto agora + ganhos/perdidos fechados no período'),
    'open_deals', private.metric(v_open, true, 'oportunidades em aberto (situação de agora)'),
    'open_value', private.metric(v_open_value, true, 'soma do valor das oportunidades em aberto (situação de agora)'),
    'won_deals', private.metric(v_won, true, 'oportunidades ganhas no período (data do fechamento)'),
    'win_rate', private.metric(case when v_won + v_lost > 0 then round(v_won * 100.0 / (v_won + v_lost), 1) end, v_won + v_lost > 0, 'ganhas ÷ (ganhas+perdidas) fechadas no período (%)'),
    'stale_deals', private.metric(v_stale, true, 'oportunidades abertas sem contato há mais de 48h (situação de agora)'),
    'commission_potential', private.metric(v_commission, v_commission_available,
      case when v_commission_available then 'estimativa sobre negócios em aberto com regra de comissão aplicável (' || v_commission_n || ' de ' || (select count(*) from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open') || ') — não é comissão adquirida, aprovada ou paga'
           else 'nenhuma regra de comissão (commission_rules) se aplica às oportunidades em aberto deste recorte — cadastre uma regra em Financeiro › Comissões e repasses' end)
  );
end $$;

grant execute on function public.crm_dashboard_metrics(timestamptz, timestamptz, uuid, uuid, uuid) to authenticated;

-- Detalhamento dos cartões do dashboard comercial — mesmo formato/painel (CardDetailSheet) do dashboard geral,
-- mas com o escopo do CRM (private.crm_units/crm_effective_owner, inclui "sales" vendo os próprios negócios).
create or replace function public.crm_card_detail(p_kind text, p_from timestamptz, p_to timestamptz, p_unit uuid default null, p_owner uuid default null, p_pipeline uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.crm_units(p_unit);
  v_owner uuid := private.crm_effective_owner(p_owner);
  v_items jsonb; v_total int; v_value numeric; v_available boolean; v_basis text; v_is_snapshot boolean := false; v_label text; v_route text := '/admin/crm/oportunidades';
begin
  if p_kind = 'crm_new_leads' then
    v_label := 'Novos leads no período'; v_basis := 'oportunidades criadas no período (fluxo de entrada)';
    select count(*) into v_value from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.created_at >= p_from and o.created_at < p_to;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'date', x.created_at, 'amount_cents', x.value_cents) order by x.created_at desc), '[]')
      into v_items from (select * from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.created_at >= p_from and o.created_at < p_to order by o.created_at desc limit 20) x;

  elsif p_kind in ('crm_open_deals', 'crm_open_value') then
    v_label := case when p_kind = 'crm_open_value' then 'Valor em negociação' else 'Negócios em aberto' end;
    v_is_snapshot := true; v_basis := 'oportunidades em aberto (situação de agora)';
    select count(*), coalesce(sum(value_cents), 0) into v_total, v_value from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open';
    if p_kind = 'crm_open_deals' then v_value := v_total; end if;
    v_available := true;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'date', x.created_at, 'amount_cents', x.value_cents) order by x.value_cents desc), '[]')
      into v_items from (select * from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open' order by o.value_cents desc limit 20) x;

  elsif p_kind = 'crm_won_deals' then
    v_label := 'Negócios ganhos'; v_basis := 'oportunidades ganhas no período (data do fechamento)';
    select count(*) into v_value from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'won' and o.closed_at >= p_from and o.closed_at < p_to;
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'date', x.closed_at, 'amount_cents', x.value_cents) order by x.closed_at desc), '[]')
      into v_items from (select * from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'won' and o.closed_at >= p_from and o.closed_at < p_to order by o.closed_at desc limit 20) x;

  elsif p_kind = 'crm_win_rate' then
    v_label := 'Conversão comercial'; v_basis := 'ganhas ÷ (ganhas+perdidas) fechadas no período (%)';
    declare v_won int; v_lost int; begin
      select count(*) filter (where status='won'), count(*) filter (where status='lost') into v_won, v_lost
        from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.closed_at >= p_from and o.closed_at < p_to;
      v_available := (v_won + v_lost) > 0; v_value := case when v_available then round(v_won * 100.0 / (v_won+v_lost), 1) end; v_total := v_won + v_lost;
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'date', x.closed_at, 'tag', case x.status when 'won' then 'Ganha' else 'Perdida' end, 'amount_cents', x.value_cents) order by x.closed_at desc), '[]')
        into v_items from (select * from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status in ('won','lost') and o.closed_at >= p_from and o.closed_at < p_to order by o.closed_at desc limit 20) x;
    end;

  elsif p_kind = 'crm_stale_deals' then
    v_label := 'Oportunidades sem retorno'; v_route := '/admin/crm/oportunidades?filtro=sem-retorno'; v_is_snapshot := true;
    v_basis := 'abertas, sem contato há mais de 48h (situação de agora)';
    select count(*) into v_value from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open' and coalesce(o.last_contact_at, o.created_at) < now() - interval '48 hours';
    v_available := true; v_total := v_value::int;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'date', coalesce(x.last_contact_at, x.created_at)) order by coalesce(x.last_contact_at, x.created_at)), '[]')
      into v_items from (select * from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open' and coalesce(o.last_contact_at, o.created_at) < now() - interval '48 hours' order by coalesce(o.last_contact_at, o.created_at) limit 20) x;

  elsif p_kind = 'crm_commission_potential' then
    v_label := 'Comissão potencial'; v_route := '/admin/financeiro/comissoes'; v_is_snapshot := true;
    declare v_n int; begin
      with open_deals as (
        select o.id, o.person_id, o.title, o.value_cents, o.product_id, o.owner_user_id
        from public.opportunities o where o.unit_id = any(u) and (v_owner is null or o.owner_user_id = v_owner) and (p_pipeline is null or o.pipeline_id = p_pipeline) and o.status = 'open'
      ), matched as (
        select d.*, (select r.percent_bp from public.commission_rules r
          where r.active and (r.product_id = d.product_id or r.product_id is null) and (r.beneficiary_user_id = d.owner_user_id or r.beneficiary_user_id is null)
          order by (r.product_id is not null) desc, (r.beneficiary_user_id is not null) desc limit 1) as percent_bp
        from open_deals d
      )
      select coalesce(sum(value_cents * percent_bp / 10000.0), 0)::bigint, count(*) filter (where percent_bp is not null) into v_value, v_n from matched;
      v_available := v_n > 0; v_total := v_n;
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', private.dcd_person_name(x.person_id), 'subtitle', x.title, 'amount_cents', (x.value_cents * x.percent_bp / 10000.0)::bigint, 'tag', (x.percent_bp/100.0) || '%') order by x.value_cents desc), '[]')
        into v_items from (select * from matched where percent_bp is not null order by value_cents desc limit 20) x;
    end;

  else
    raise exception 'tipo de detalhamento desconhecido: %', p_kind;
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'label', v_label, 'value', v_value, 'available', v_available, 'basis', v_basis,
    'is_current_snapshot', v_is_snapshot, 'period', jsonb_build_object('from', p_from, 'to', p_to),
    'items', v_items, 'total_items', v_total, 'list_route', v_route
  );
end $$;

grant execute on function public.crm_card_detail(text, timestamptz, timestamptz, uuid, uuid, uuid) to authenticated;
