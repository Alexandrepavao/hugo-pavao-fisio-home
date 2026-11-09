-- HP Group Hub — 115 Marketing: FUNIS personalizados (jornada em etapas escolhidas pelo administrador) e PAINÉIS personalizáveis (cartões/gráficos que cada pessoa escolhe e salva).
--  • Funil: lista ordenada de etapas tiradas de um catálogo (mídia da plataforma + eventos confirmados no Hub). Conversão etapa a etapa pelos TOTAIS; custo por etapa quando há gasto coberto;
--    gargalo = menor conversão entre etapas com volume suficiente (nunca com volume pequeno). Impressões e cliques são EVENTOS DE MÍDIA; as demais etapas são pessoas/oportunidades/vendas do Hub.
--  • Painel: lista de widgets validada no servidor (tipos e parâmetros permitidos). Pessoal (só o dono) ou compartilhado (toda a equipe com acesso ao Marketing; só administrador edita os compartilhados).

create table public.mkt_funnel_step_types (key text primary key, label text not null, source text not null check (source in ('media','hub')), description text not null, position int not null);
insert into public.mkt_funnel_step_types (key, label, source, description, position) values
  ('impressions', 'Impressões', 'media', 'Impressões informadas pelas plataformas (evento de mídia).', 1),
  ('clicks', 'Cliques no link', 'media', 'Cliques no link (Meta: inline_link_clicks · Google: metrics.clicks).', 2),
  ('lead', 'Lead', 'hub', 'Pessoas distintas com oportunidade atribuída a campanha.', 3),
  ('opportunity', 'Oportunidade', 'hub', 'Oportunidades criadas no CRM.', 4),
  ('qualified', 'Lead qualificado (MQL)', 'hub', 'Oportunidades que chegaram a etapa marcada como qualificação.', 5),
  ('scheduled', 'Agendamento (SAL)', 'hub', 'Oportunidades com atendimento agendado.', 6),
  ('eval_done', 'Avaliação realizada', 'hub', 'Atendimentos realizados de serviço marcado como avaliação.', 7),
  ('attended', 'Compareceu', 'hub', 'Oportunidades com atendimento realizado.', 8),
  ('sold', 'Venda', 'hub', 'Oportunidades com venda confirmada atribuída.', 9),
  ('new_buyer', 'Novo comprador', 'hub', 'Vendas de cliente novo (primeira compra confirmada).', 10),
  ('received', 'Recebimento', 'hub', 'Oportunidades com recebimento líquido de estorno.', 11),
  ('repeat_buyer', 'Recompra', 'hub', 'Vendas de quem já comprou o mesmo produto.', 12),
  ('expansion_buyer', 'Expansão', 'hub', 'Vendas de quem já comprou, com produto novo.', 13),
  ('enrollment', 'Matrícula / mentoria', 'hub', 'Vendas confirmadas de curso ou mentoria.', 14),
  ('partner_approved', 'Parceiro aprovado', 'hub', 'Parceiros aprovados depois da oportunidade.', 15),
  ('partner_active', 'Parceiro ativo', 'hub', 'Aprovados que indicaram nos últimos N dias (configurado).', 16),
  ('won', 'Oportunidade ganha', 'hub', 'Oportunidades com status ganha.', 17),
  ('lost', 'Oportunidade perdida', 'hub', 'Oportunidades com status perdida.', 18);
alter table public.mkt_funnel_step_types enable row level security; create policy mkt_fst_read on public.mkt_funnel_step_types for select to authenticated using (true);
revoke all on public.mkt_funnel_step_types from anon; revoke insert, update, delete, truncate on public.mkt_funnel_step_types from authenticated;

create table public.mkt_funnels (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60), steps jsonb not null, position int not null default 0, active boolean not null default true, created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table public.mkt_dashboards (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade, owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60), widgets jsonb not null default '[]', shared boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index mkt_dashboards_org on public.mkt_dashboards (org_id, shared);
alter table public.mkt_funnels enable row level security; alter table public.mkt_dashboards enable row level security;
revoke all on public.mkt_funnels, public.mkt_dashboards from anon, authenticated;       -- acesso só por funções

-- validação das etapas do funil
create or replace function private.mkt_steps_valid(p jsonb) returns boolean language plpgsql stable set search_path = '' as $$
declare x jsonb; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  for x in select * from jsonb_array_elements(p) loop
    n := n + 1; if n > 12 then return false; end if;
    if jsonb_typeof(x) <> 'object' or not exists (select 1 from public.mkt_funnel_step_types t where t.key = x ->> 'kind') then return false; end if;
    if coalesce(length(x ->> 'label'), 0) > 40 then return false; end if;
  end loop;
  return n >= 2;
end $$;

-- validação dos widgets do painel: só tipos e parâmetros conhecidos
create or replace function private.mkt_widgets_valid(p jsonb) returns boolean language plpgsql stable set search_path = '' as $$
declare x jsonb; n int := 0; t text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  for x in select * from jsonb_array_elements(p) loop
    n := n + 1; if n > 24 or jsonb_typeof(x) <> 'object' then return false; end if;
    t := x ->> 'type'; if coalesce(x ->> 'id', '') !~ '^[a-zA-Z0-9_-]{1,40}$' then return false; end if;
    if coalesce(x ->> 'span', '1') not in ('1','2') then return false; end if;
    if t = 'kpi' then if coalesce(x ->> 'key', '') !~ '^[a-z_]{2,40}$' then return false; end if;
    elsif t = 'series' then if coalesce(x ->> 'metric', '') not in ('spend','leads','qualified','sales','received') then return false; end if;
    elsif t = 'funnel' then if coalesce(x ->> 'funnel_id', '') !~ '^[0-9a-f-]{36}$' then return false; end if;
    elsif t = 'campaigns' then if coalesce(x ->> 'top', '5') !~ '^[0-9]{1,2}$' or coalesce(x ->> 'sort', 'spend') not in ('spend','leads','roas','cpl') then return false; end if;
    elsif t = 'note' then if coalesce(length(x ->> 'text'), 0) > 500 then return false; end if;
    elsif t not in ('quality','reconciliation') then return false; end if;
  end loop;
  return true;
end $$;

-- padrões por organização: funis e um painel compartilhado de resumo (editáveis)
create or replace function private.mkt_seed_defaults(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_f uuid; v_owner uuid;
begin
  insert into public.mkt_settings (org_id) values (p_org) on conflict do nothing;
  if not exists (select 1 from public.mkt_fronts where org_id = p_org) then
    insert into public.mkt_fronts (org_id, label, business_line, position) values (p_org, 'HP Fisioterapia', 'physio', 1), (p_org, 'HP Academy', 'academy', 2), (p_org, 'HP Tech', null, 3);
  end if;
  if not exists (select 1 from public.mkt_purposes where org_id = p_org) then
    insert into public.mkt_purposes (org_id, label, default_result, position) values
      (p_org, 'Captar pacientes', 'evaluation_done', 1), (p_org, 'Captar parceiros', 'partner_approved', 2), (p_org, 'Vender mentoria', 'sale', 3),
      (p_org, 'Vender tecnologia', 'sale', 4), (p_org, 'Assinatura', 'sale', 5);
  end if;
  insert into public.mkt_connections (org_id, platform) values (p_org, 'meta'), (p_org, 'google') on conflict do nothing;
  if not exists (select 1 from public.mkt_funnels where org_id = p_org) then
    insert into public.mkt_funnels (org_id, name, steps, position) values
      (p_org, 'Pacientes: do anúncio ao pacote', '[{"kind":"impressions"},{"kind":"clicks"},{"kind":"lead"},{"kind":"qualified"},{"kind":"scheduled"},{"kind":"attended"},{"kind":"sold"},{"kind":"received"},{"kind":"repeat_buyer"}]'::jsonb, 1),
      (p_org, 'Parceiros', '[{"kind":"clicks"},{"kind":"lead"},{"kind":"qualified"},{"kind":"partner_approved"},{"kind":"partner_active"}]'::jsonb, 2),
      (p_org, 'Academy e mentorias', '[{"kind":"clicks"},{"kind":"lead"},{"kind":"qualified"},{"kind":"enrollment"},{"kind":"received"}]'::jsonb, 3);
  end if;
  if not exists (select 1 from public.mkt_dashboards where org_id = p_org and shared) then
    select user_id into v_owner from public.role_assignments where org_id = p_org and role = 'manager' and revoked_at is null order by valid_from limit 1;
    select id into v_f from public.mkt_funnels where org_id = p_org order by position limit 1;
    if v_owner is not null then
      insert into public.mkt_dashboards (org_id, owner_user_id, name, shared, widgets) values (p_org, v_owner, 'Resumo executivo', true, jsonb_build_array(
        jsonb_build_object('id', 'k1', 'type', 'kpi', 'key', 'spend'), jsonb_build_object('id', 'k2', 'type', 'kpi', 'key', 'leads'), jsonb_build_object('id', 'k3', 'type', 'kpi', 'key', 'qualified'), jsonb_build_object('id', 'k4', 'type', 'kpi', 'key', 'cpl'),
        jsonb_build_object('id', 'k5', 'type', 'kpi', 'key', 'new_buyers'), jsonb_build_object('id', 'k6', 'type', 'kpi', 'key', 'sold'), jsonb_build_object('id', 'k7', 'type', 'kpi', 'key', 'received'), jsonb_build_object('id', 'k8', 'type', 'kpi', 'key', 'roas_sales'),
        jsonb_build_object('id', 'f1', 'type', 'funnel', 'funnel_id', v_f, 'span', '2'), jsonb_build_object('id', 's1', 'type', 'series', 'metric', 'spend'), jsonb_build_object('id', 's2', 'type', 'series', 'metric', 'leads'),
        jsonb_build_object('id', 'c1', 'type', 'campaigns', 'top', '8', 'sort', 'spend', 'span', '2')));
    end if;
  end if;
end $$;
revoke all on function private.mkt_seed_defaults(uuid) from public, anon, authenticated;
select private.mkt_seed_defaults(id) from public.organizations;

-- ---------------------------------------------------------------- funis: listar / salvar / excluir / executar
create or replace function public.mkt_funnels_list() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader();
begin
  perform private.mkt_seed_defaults(v_org);
  return jsonb_build_object('funnels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'steps', steps, 'position', position) order by position, name), '[]') from public.mkt_funnels where org_id = v_org and active),
    'step_types', (select coalesce(jsonb_agg(to_jsonb(t) - 'position' order by t.position), '[]') from public.mkt_funnel_step_types t));
end $$;
create or replace function public.mkt_funnel_save(p_id uuid, p_name text, p_steps jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); v_id uuid;
begin
  if not private.mkt_steps_valid(p_steps) then raise exception 'etapas inválidas: use de 2 a 12 etapas do catálogo'; end if;
  if p_id is null then
    if (select count(*) from public.mkt_funnels where org_id = v_org and active) >= 12 then raise exception 'no máximo 12 funis'; end if;
    insert into public.mkt_funnels (org_id, name, steps, position) values (v_org, btrim(p_name), p_steps, (select coalesce(max(position), 0) + 1 from public.mkt_funnels where org_id = v_org)) returning id into v_id;
  else
    update public.mkt_funnels set name = btrim(p_name), steps = p_steps where id = p_id and org_id = v_org returning id into v_id; if v_id is null then raise exception 'funil não encontrado' using errcode = '42501'; end if;
  end if;
  return v_id;
end $$;
create or replace function public.mkt_funnel_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin();
begin delete from public.mkt_funnels where id = p_id and org_id = v_org; end $$;

create or replace function public.mkt_funnel_run(p_funnel uuid, p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); fn public.mkt_funnels; u uuid[]; f jsonb; cur text; cov jsonb; st jsonb; steps jsonb := '[]'::jsonb; x jsonb; k text; n numeric; av boolean; why text; prev numeric; first numeric; i int := 0;
  spend numeric; media jsonb; rate numeric; worst numeric; worst_i int; rates numeric[] := '{}'; avs boolean[] := '{}'; counts numeric[] := '{}'; prevs numeric[] := '{}';
begin
  if p_view not in ('event','cohort') then raise exception 'visão inválida'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'período inválido'; end if;
  select * into fn from public.mkt_funnels where id = p_funnel and org_id = v_org and active; if fn.id is null then raise exception 'funil não encontrado'; end if;
  u := private.mkt_units_scope(p_filters); f := private.mkt_facts(p_from, p_to, p_filters, p_view, u); cur := f ->> 'currency'; cov := f -> 'coverage';
  media := f -> 'spend' -> cur; spend := case when (cov ->> 'accounts')::int > 0 and (cov ->> 'ok_days')::int > 0 and nullif(p_filters ->> 'owner', '') is null then (media ->> 'spend')::numeric end;
  for x in select * from jsonb_array_elements(fn.steps) loop
    i := i + 1; k := x ->> 'kind';
    av := true; why := null;
    if k in ('impressions','clicks') then
      n := (media ->> case k when 'impressions' then 'impressions' else 'clicks' end)::numeric; av := n is not null and (cov ->> 'ok_days')::int > 0; why := case when not av then 'Sem dado de mídia coletado ou lançado no período.' end;
    else
      n := private.mkt_num(f, case k when 'sold' then 'sold' when 'received' then 'received' else k end);
      if k = 'qualified' and not (f ->> 'qualified_configured')::boolean then av := false; why := 'Etapas de qualificação não configuradas.';
      elsif k = 'eval_done' and not (f ->> 'evaluation_configured')::boolean then av := false; why := 'Serviços de avaliação não configurados.';
      elsif k = 'partner_active' and not (f ->> 'partner_active_configured')::boolean then av := false; why := 'Critério de parceiro ativo não configurado.'; end if;
    end if;
    rate := case when av and prev is not null and prev > 0 then round(100.0 * n / prev, 2) end;
    steps := steps || jsonb_build_object('index', i, 'kind', k, 'label', coalesce(nullif(btrim(x ->> 'label'), ''), (select label from public.mkt_funnel_step_types where key = k)), 'source', (select source from public.mkt_funnel_step_types where key = k),
      'count', case when av then n end, 'available', av, 'reason', why, 'rate_from_previous', rate, 'rate_from_first', case when av and first is not null and first > 0 then round(100.0 * n / first, 2) end,
      'cost_per_step', case when av and spend is not null and n > 0 then round(spend / n, 2) end, 'previous_count', case when av then prev end);
    counts := counts || coalesce(n, 0); avs := avs || av; rates := rates || coalesce(rate, -1);
    if av then prev := n; if first is null then first := n; end if; end if;
  end loop;
  -- gargalo: menor conversão (etapa a etapa) entre etapas do Hub com volume anterior ≥ 10 (volume pequeno não aponta gargalo)
  worst := null;
  for i in 2..coalesce(jsonb_array_length(steps), 0) loop
    x := steps -> (i - 1); if (x ->> 'available')::boolean and x -> 'rate_from_previous' <> 'null'::jsonb and coalesce((x ->> 'previous_count')::numeric, 0) >= 10 and x ->> 'source' = 'hub' and (steps -> (i - 2)) ->> 'source' = 'hub' then
      if worst is null or (x ->> 'rate_from_previous')::numeric < worst then worst := (x ->> 'rate_from_previous')::numeric; worst_i := i; end if; end if;
  end loop;
  return jsonb_build_object('funnel', jsonb_build_object('id', fn.id, 'name', fn.name), 'view', p_view, 'steps', steps, 'bottleneck_index', worst_i, 'currency', cur, 'coverage', cov, 'spend', spend,
    'basis', case p_view when 'cohort' then 'Coorte: leads captados no período e tudo o que aconteceu com eles até hoje.' else 'Por data do evento: cada etapa contada na própria data, dentro do período.' end,
    'notes', jsonb_build_array('Impressões e cliques são eventos de mídia; as demais etapas são pessoas, oportunidades ou vendas do Hub (cada uma contada uma vez).', 'O gargalo só é apontado entre etapas do Hub com pelo menos 10 no passo anterior.'));
end $$;

-- ---------------------------------------------------------------- painéis
create or replace function public.mkt_dashboards_list() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); v_me uuid := (select auth.uid());
begin
  perform private.mkt_seed_defaults(v_org);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'widgets', d.widgets, 'shared', d.shared, 'mine', d.owner_user_id = v_me, 'can_edit', d.owner_user_id = v_me or (d.shared and private.mkt_admin()),
    'owner', (select display_name from public.user_accounts ua where ua.user_id = d.owner_user_id), 'updated_at', d.updated_at) order by d.shared desc, d.name) from public.mkt_dashboards d where d.org_id = v_org and (d.shared or d.owner_user_id = v_me)), '[]'::jsonb);
end $$;
create or replace function public.mkt_dashboard_save(p_id uuid, p_name text, p_widgets jsonb, p_shared boolean default false) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); v_me uuid := (select auth.uid()); d public.mkt_dashboards; v_id uuid;
begin
  if not private.mkt_widgets_valid(p_widgets) then raise exception 'widgets inválidos'; end if;
  if coalesce(p_shared, false) and not private.mkt_admin() then raise exception 'só administradores compartilham painéis com a equipe' using errcode = '42501'; end if;
  if p_id is null then
    if (select count(*) from public.mkt_dashboards where org_id = v_org and owner_user_id = v_me) >= 20 then raise exception 'no máximo 20 painéis por pessoa'; end if;
    insert into public.mkt_dashboards (org_id, owner_user_id, name, widgets, shared) values (v_org, v_me, btrim(p_name), p_widgets, coalesce(p_shared, false)) returning id into v_id;
  else
    select * into d from public.mkt_dashboards where id = p_id and org_id = v_org; if d.id is null then raise exception 'painel não encontrado' using errcode = '42501'; end if;
    if not (d.owner_user_id = v_me or (d.shared and private.mkt_admin())) then raise exception 'sem permissão para editar este painel' using errcode = '42501'; end if;
    update public.mkt_dashboards set name = btrim(p_name), widgets = p_widgets, shared = case when private.mkt_admin() then coalesce(p_shared, shared) else shared end, updated_at = now() where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;
create or replace function public.mkt_dashboard_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); v_me uuid := (select auth.uid());
begin delete from public.mkt_dashboards where id = p_id and org_id = v_org and (owner_user_id = v_me or (shared and private.mkt_admin())); end $$;
create or replace function public.mkt_dashboard_duplicate(p_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); v_me uuid := (select auth.uid()); d public.mkt_dashboards; v_id uuid;
begin
  select * into d from public.mkt_dashboards where id = p_id and org_id = v_org and (shared or owner_user_id = v_me); if d.id is null then raise exception 'painel não encontrado' using errcode = '42501'; end if;
  insert into public.mkt_dashboards (org_id, owner_user_id, name, widgets, shared) values (v_org, v_me, left(d.name || ' (cópia)', 60), d.widgets, false) returning id into v_id; return v_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['mkt_funnels_list()','mkt_funnel_save(uuid,text,jsonb)','mkt_funnel_delete(uuid)','mkt_funnel_run(uuid,date,date,jsonb,text)','mkt_dashboards_list()','mkt_dashboard_save(uuid,text,jsonb,boolean)','mkt_dashboard_delete(uuid)','mkt_dashboard_duplicate(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.mkt_steps_valid(jsonb), private.mkt_widgets_valid(jsonb) from public, anon, authenticated;
