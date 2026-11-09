-- HP Group Hub — 106 Marketing: funções de configuração (administrador), classificação com histórico, lançamento manual de gastos, execução/ingestão de sincronização (service role).
-- Escrita sempre por função; todas as de administrador exigem manager/ops_admin da PRÓPRIA organização (private.mkt_admin). As de ingestão só a service role executa (Edge Function).

create or replace function private.mkt_require_admin() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null or not private.mkt_admin() then raise exception 'sem permissão: apenas administradores configuram o Marketing' using errcode = '42501'; end if;
  return v_org;
end $$;
create or replace function private.mkt_require_reader() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null or not private.mkt_reader() then raise exception 'sem permissão para o Marketing' using errcode = '42501'; end if;
  return v_org;
end $$;

-- ---------------------------------------------------------------- configuração (leitura completa para o administrador; sem nenhuma credencial)
create or replace function public.mkt_config_get() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin();
begin
  perform private.mkt_seed_defaults(v_org);
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'updated_by' from public.mkt_settings s where org_id = v_org),
    'fronts', (select coalesce(jsonb_agg(to_jsonb(f) order by f.position, f.label), '[]') from public.mkt_fronts f where org_id = v_org),
    'purposes', (select coalesce(jsonb_agg(to_jsonb(p) order by p.position, p.label), '[]') from public.mkt_purposes p where org_id = v_org),
    'event_types', (select coalesce(jsonb_agg(to_jsonb(e) order by e.position), '[]') from public.mkt_event_types e),
    'connections', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'platform', c.platform, 'enabled', c.enabled, 'status', c.status, 'provider_user_label', c.provider_user_label,
        'granted_scopes', c.granted_scopes, 'token_expires_at', c.token_expires_at, 'api_version', c.api_version, 'connected_at', c.connected_at, 'last_error', c.last_error, 'last_error_at', c.last_error_at,
        'last_sync_at', c.last_sync_at, 'last_ok_at', c.last_ok_at) order by c.platform), '[]') from public.mkt_connections c where org_id = v_org),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.platform, 'origin', a.origin, 'external_id', a.external_id, 'name', a.name, 'currency', a.currency, 'timezone', a.timezone,
        'platform_status', a.platform_status, 'selected', a.selected, 'unit_id', a.unit_id, 'login_customer_id', a.login_customer_id, 'connection_id', a.connection_id,
        'last_run', (select to_jsonb(r) - 'org_id' from (select id, kind, status, started_at, finished_at, rows_written, error_code, error_message, window_from, window_to from public.mkt_sync_runs x where x.account_id = a.id order by started_at desc limit 1) r),
        'covered_days', (select count(*) from public.mkt_day_status d where d.account_id = a.id and d.status = 'ok'),
        'last_ok_day', (select max(day) from public.mkt_day_status d where d.account_id = a.id and d.status = 'ok')) order by a.platform, a.name), '[]') from public.mkt_ad_accounts a where org_id = v_org),
    'pipelines', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'stages', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'kind', s.kind) order by s.position), '[]')
        from public.pipeline_stages s where s.pipeline_id = p.id)) order by p.name), '[]') from public.pipelines p where p.org_id = v_org and p.active),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.services where org_id = v_org and active),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind) order by name), '[]') from public.products where org_id = v_org and active),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.units where org_id = v_org));
end $$;

create or replace function public.mkt_settings_set(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); cur public.mkt_settings; n public.mkt_settings; bump boolean := false; v_q uuid[]; v_e uuid[];
begin
  perform private.mkt_seed_defaults(v_org); select * into cur from public.mkt_settings where org_id = v_org; n := cur;
  if p ? 'attribution_window_days' then n.attribution_window_days := (p ->> 'attribution_window_days')::int; end if;
  if p ? 'reprocess_days' then n.reprocess_days := (p ->> 'reprocess_days')::int; end if;
  if p ? 'backfill_days' then n.backfill_days := (p ->> 'backfill_days')::int; end if;
  if p ? 'manual_refresh_min_minutes' then n.manual_refresh_min_minutes := (p ->> 'manual_refresh_min_minutes')::int; end if;
  if p ? 'stale_after_hours' then n.stale_after_hours := (p ->> 'stale_after_hours')::int; end if;
  if p ? 'reporting_currency' then n.reporting_currency := upper(p ->> 'reporting_currency'); end if;
  if p ? 'partner_active_days' then n.partner_active_days := nullif(p ->> 'partner_active_days', '')::int; end if;
  if p ? 'paid_mediums' then n.paid_mediums := (select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}') from jsonb_array_elements_text(p -> 'paid_mediums') x); end if;
  if p ? 'qualified_stage_ids' then
    select coalesce(array_agg(s.id), '{}') into v_q from public.pipeline_stages s where s.org_id = v_org and s.id::text in (select jsonb_array_elements_text(p -> 'qualified_stage_ids')); n.qualified_stage_ids := v_q; end if;
  if p ? 'evaluation_service_ids' then
    select coalesce(array_agg(s.id), '{}') into v_e from public.services s where s.org_id = v_org and s.id::text in (select jsonb_array_elements_text(p -> 'evaluation_service_ids')); n.evaluation_service_ids := v_e; end if;
  -- regras que mudam a leitura dos resultados sobem a versão (a atribuição já calculada guarda a versão usada e NÃO muda sozinha)
  bump := n.attribution_window_days <> cur.attribution_window_days or n.paid_mediums <> cur.paid_mediums or n.qualified_stage_ids <> cur.qualified_stage_ids
       or n.evaluation_service_ids <> cur.evaluation_service_ids or n.partner_active_days is distinct from cur.partner_active_days;
  update public.mkt_settings set attribution_window_days = n.attribution_window_days, reprocess_days = n.reprocess_days, backfill_days = n.backfill_days, manual_refresh_min_minutes = n.manual_refresh_min_minutes,
    stale_after_hours = n.stale_after_hours, reporting_currency = n.reporting_currency, partner_active_days = n.partner_active_days, paid_mediums = n.paid_mediums, qualified_stage_ids = n.qualified_stage_ids,
    evaluation_service_ids = n.evaluation_service_ids, config_version = cur.config_version + (case when bump then 1 else 0 end), updated_by = (select auth.uid()), updated_at = now() where org_id = v_org;
  return (select to_jsonb(s) - 'updated_by' from public.mkt_settings s where org_id = v_org) || jsonb_build_object('rules_changed', bump,
    'note', case when bump then 'Regras alteradas: as atribuições já calculadas continuam como estavam. Use “Recalcular atribuição” para aplicar a nova regra a um período, de forma explícita.' end);
end $$;

create or replace function public.mkt_front_save(p_id uuid, p_label text, p_business_line text default null, p_position int default 0, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); v_id uuid;
begin
  if p_business_line is not null and p_business_line not in ('physio','academy') then raise exception 'linha de negócio inválida'; end if;
  if p_id is null then insert into public.mkt_fronts (org_id, label, business_line, position, active) values (v_org, btrim(p_label), p_business_line, coalesce(p_position, 0), coalesce(p_active, true)) returning id into v_id;
  else update public.mkt_fronts set label = btrim(p_label), business_line = p_business_line, position = coalesce(p_position, position), active = coalesce(p_active, active) where id = p_id and org_id = v_org returning id into v_id;
       if v_id is null then raise exception 'frente não encontrada'; end if; end if;
  return v_id;
end $$;
create or replace function public.mkt_purpose_save(p_id uuid, p_label text, p_default_result text default null, p_position int default 0, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); v_id uuid;
begin
  if p_default_result is not null and not exists (select 1 from public.mkt_event_types where key = p_default_result) then raise exception 'resultado não suportado'; end if;
  if p_id is null then insert into public.mkt_purposes (org_id, label, default_result, position, active) values (v_org, btrim(p_label), p_default_result, coalesce(p_position, 0), coalesce(p_active, true)) returning id into v_id;
  else update public.mkt_purposes set label = btrim(p_label), default_result = p_default_result, position = coalesce(p_position, position), active = coalesce(p_active, active) where id = p_id and org_id = v_org returning id into v_id;
       if v_id is null then raise exception 'finalidade não encontrada'; end if; end if;
  return v_id;
end $$;

-- habilitar/desabilitar uma plataforma NÃO mexe em campanhas externas: só decide se o Hub sincroniza e mostra
create or replace function public.mkt_connection_enable(p_platform text, p_enabled boolean) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin();
begin
  if p_platform not in ('meta','google') then raise exception 'plataforma inválida'; end if;
  perform private.mkt_seed_defaults(v_org);
  update public.mkt_connections set enabled = p_enabled where org_id = v_org and platform = p_platform;
end $$;

-- escolha de contas: só entre as DESCOBERTAS pela API para esta organização (não há como vincular uma conta arbitrária informando um id)
create or replace function public.mkt_account_select(p_account uuid, p_selected boolean, p_unit uuid default null) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); a public.mkt_ad_accounts;
begin
  select * into a from public.mkt_ad_accounts where id = p_account and org_id = v_org; if a.id is null then raise exception 'conta não encontrada nesta organização' using errcode = '42501'; end if;
  if p_unit is not null and not exists (select 1 from public.units where id = p_unit and org_id = v_org) then raise exception 'unidade inválida'; end if;
  if p_selected and a.origin = 'api' and not exists (select 1 from public.mkt_connections c where c.id = a.connection_id and c.status = 'active' and c.enabled) then
    raise exception 'a conexão desta conta não está ativa e habilitada'; end if;
  begin
    update public.mkt_ad_accounts set selected = p_selected, unit_id = p_unit, selected_by = case when p_selected then (select auth.uid()) end, selected_at = case when p_selected then now() end where id = p_account;
  exception when unique_violation then raise exception 'esta conta de anúncios já está vinculada a outra organização';
  end;
end $$;

-- ---------------------------------------------------------------- lançamento manual de gastos (até haver acesso à API) e importação em lote
create or replace function public.mkt_manual_account_create(p_platform text, p_name text, p_currency text, p_timezone text default 'America/Sao_Paulo', p_unit uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); v_id uuid;
begin
  if p_platform not in ('meta','google') then raise exception 'plataforma inválida'; end if;
  if upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'moeda inválida (use o código de 3 letras, ex.: BRL)'; end if;
  if p_unit is not null and not exists (select 1 from public.units where id = p_unit and org_id = v_org) then raise exception 'unidade inválida'; end if;
  insert into public.mkt_ad_accounts (org_id, platform, origin, external_id, name, currency, timezone, selected, selected_by, selected_at, unit_id)
    values (v_org, p_platform, 'manual', 'manual:' || gen_random_uuid()::text, btrim(p_name), upper(p_currency), p_timezone, true, (select auth.uid()), now(), p_unit) returning id into v_id;
  return v_id;
end $$;
create or replace function public.mkt_manual_campaign_create(p_account uuid, p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); v_id uuid;
begin
  if not exists (select 1 from public.mkt_ad_accounts where id = p_account and org_id = v_org and selected) then raise exception 'conta não encontrada ou não selecionada'; end if;
  insert into public.mkt_campaigns (org_id, account_id, external_id, origin, name) values (v_org, p_account, 'manual:' || gen_random_uuid()::text, 'manual', btrim(p_name)) returning id into v_id;
  return v_id;
end $$;

-- resolve sobreposição manual × API por CONTA × DIA, de forma explícita: com API coletada no dia, o lançamento manual do dia fica "substituído pela API" (visível, fora da soma),
-- salvo se o administrador marcou o manual como prioritário — aí é a API do dia que fica fora da soma. Nunca somam os dois.
create or replace function private.mkt_resolve_overlap(p_account uuid, p_from date, p_to date) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.mkt_spend_daily m set resolution = case
      when m.source = 'manual' and exists (select 1 from public.mkt_spend_daily a where a.account_id = m.account_id and a.day = m.day and a.source = 'api') and not exists (
           select 1 from public.mkt_spend_daily p where p.account_id = m.account_id and p.day = m.day and p.source = 'manual' and p.manual_priority) then 'superseded_by_api'
      when m.source = 'api' and exists (select 1 from public.mkt_spend_daily p where p.account_id = m.account_id and p.day = m.day and p.source = 'manual' and p.manual_priority) then 'superseded_by_manual'
      else 'active' end
   where m.account_id = p_account and m.day between p_from and p_to;
end $$;

create or replace function public.mkt_spend_manual_upsert(p_campaign uuid, p_day date, p_amount numeric, p_currency text default null, p_impressions bigint default null, p_clicks bigint default null,
  p_note text default null, p_prefer_manual boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); c public.mkt_campaigns; a public.mkt_ad_accounts; v_cur text; v_id bigint;
begin
  select * into c from public.mkt_campaigns where id = p_campaign and org_id = v_org; if c.id is null then raise exception 'campanha não encontrada'; end if;
  select * into a from public.mkt_ad_accounts where id = c.account_id;
  if p_day is null or p_day > (now() at time zone coalesce(a.timezone, 'America/Sao_Paulo'))::date then raise exception 'data inválida: não há gasto em data futura'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'valor inválido'; end if;
  v_cur := upper(coalesce(p_currency, a.currency)); if v_cur is null or v_cur !~ '^[A-Z]{3}$' then raise exception 'informe a moeda'; end if;
  if a.currency is not null and v_cur <> a.currency then raise exception 'a moeda do lançamento (%) difere da moeda da conta (%)', v_cur, a.currency; end if;
  insert into public.mkt_spend_daily (org_id, account_id, campaign_id, day, source, currency, tz, spend, impressions, link_clicks, clicks_all, note, created_by, manual_priority, collected_at)
    values (v_org, c.account_id, c.id, p_day, 'manual', v_cur, coalesce(a.timezone, 'America/Sao_Paulo'), p_amount, p_impressions, p_clicks, p_clicks, left(p_note, 300), (select auth.uid()), coalesce(p_prefer_manual, false), now())
    on conflict (org_id, account_id, campaign_id, day, source) do update set spend = excluded.spend, impressions = excluded.impressions, link_clicks = excluded.link_clicks, clicks_all = excluded.clicks_all,
      note = excluded.note, manual_priority = excluded.manual_priority, currency = excluded.currency, collected_at = now(), created_by = excluded.created_by
    returning id into v_id;
  perform private.mkt_resolve_overlap(c.account_id, p_day, p_day);
  return v_id;
end $$;
create or replace function public.mkt_spend_manual_delete(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r public.mkt_spend_daily;
begin
  select * into r from public.mkt_spend_daily where id = p_id and org_id = v_org and source = 'manual'; if r.id is null then raise exception 'lançamento manual não encontrado'; end if;
  delete from public.mkt_spend_daily where id = p_id; perform private.mkt_resolve_overlap(r.account_id, r.day, r.day);
end $$;
-- importação em lote (ex.: CSV lido no navegador): cada linha {day, account, campaign, currency, amount}; conta e campanha são buscadas pelo NOME dentro da organização; erro por linha, sem abortar as demais
create or replace function public.mkt_spend_manual_import(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r jsonb; i int := 0; ok int := 0; errs jsonb := '[]'::jsonb; v_acc uuid; v_camp uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'envie até 2000 linhas'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      select a.id into v_acc from public.mkt_ad_accounts a where a.org_id = v_org and a.selected and a.origin = 'manual' and lower(a.name) = lower(btrim(r ->> 'account'))
        and (r ->> 'platform' is null or a.platform = r ->> 'platform') having count(*) = 1;
      if v_acc is null then raise exception 'conta manual não encontrada (ou nome ambíguo): %', coalesce(r ->> 'account', '(vazio)'); end if;
      select c.id into v_camp from public.mkt_campaigns c where c.account_id = v_acc and lower(c.name) = lower(btrim(r ->> 'campaign')) limit 1;
      if v_camp is null then v_camp := public.mkt_manual_campaign_create(v_acc, r ->> 'campaign'); end if;
      perform public.mkt_spend_manual_upsert(v_camp, (r ->> 'day')::date, replace(r ->> 'amount', ',', '.')::numeric, r ->> 'currency', null, null, 'importação em lote', coalesce((r ->> 'prefer_manual')::boolean, false));
      ok := ok + 1;
    exception when others then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('imported', ok, 'errors', errs);
end $$;

-- ---------------------------------------------------------------- classificação comercial interna (com histórico e explicação do efeito)
create or replace function private.mkt_class_effect(p_campaign uuid, p_before jsonb, p_after jsonb) returns text language plpgsql security definer set search_path = '' as $$
declare v_spend numeric; v_cur text; v_leads bigint; o text; n text;
begin
  select coalesce(sum(spend), 0), min(currency) into v_spend, v_cur from public.mkt_spend_daily where campaign_id = p_campaign and resolution = 'active' and day >= current_date - 90;
  select count(*) into v_leads from public.mkt_attributions a join public.mkt_touches t on t.id = a.touch_id where t.campaign_id = p_campaign and a.outcome = 'attributed';
  o := case when p_before ->> 'state' = 'pending' then 'Aguardando classificação' else 'frente/finalidade anteriores' end;
  n := case when p_after ->> 'state' = 'pending' then 'Aguardando classificação' else 'a nova classificação' end;
  return format('A classificação é aplicada na leitura dos relatórios, não é congelada: TODO o histórico desta campanha (%s de investimento nos últimos 90 dias e %s lead(s) atribuído(s)) passa de “%s” para “%s” em todos os períodos. Nada muda na campanha dentro da plataforma.',
                coalesce(to_char(v_spend, 'FM999G999G990D00'), '0') || coalesce(' ' || v_cur, ''), v_leads, o, n)
         || case when (p_before ->> 'include_in_hub')::boolean is distinct from (p_after ->> 'include_in_hub')::boolean then
              case when (p_after ->> 'include_in_hub')::boolean then ' A campanha volta a aparecer no dashboard.' else ' A campanha deixa de aparecer no dashboard, mas segue na reconciliação como “Fora do dashboard”.' end else '' end;
end $$;

create or replace function public.mkt_class_save(p_campaign uuid, p_patch jsonb, p_dry_run boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); cur public.mkt_campaign_class; n public.mkt_campaign_class; b jsonb; a jsonb; v_effect text;
begin
  if not exists (select 1 from public.mkt_campaigns where id = p_campaign and org_id = v_org) then raise exception 'campanha não encontrada nesta organização' using errcode = '42501'; end if;
  select * into cur from public.mkt_campaign_class where campaign_id = p_campaign; n := cur;
  if p_patch ? 'front_id' then n.front_id := nullif(p_patch ->> 'front_id', '')::uuid; end if;
  if p_patch ? 'purpose_id' then n.purpose_id := nullif(p_patch ->> 'purpose_id', '')::uuid; end if;
  if p_patch ? 'product_id' then n.product_id := nullif(p_patch ->> 'product_id', '')::uuid; end if;
  if p_patch ? 'pipeline_id' then n.pipeline_id := nullif(p_patch ->> 'pipeline_id', '')::uuid; end if;
  if p_patch ? 'unit_id' then n.unit_id := nullif(p_patch ->> 'unit_id', '')::uuid; end if;
  if p_patch ? 'primary_result' then n.primary_result := nullif(p_patch ->> 'primary_result', ''); end if;
  if p_patch ? 'include_in_hub' then n.include_in_hub := (p_patch ->> 'include_in_hub')::boolean; end if;
  if p_patch ? 'include_in_reports' then n.include_in_reports := (p_patch ->> 'include_in_reports')::boolean; end if;
  if n.front_id is not null and not exists (select 1 from public.mkt_fronts where id = n.front_id and org_id = v_org) then raise exception 'frente inválida'; end if;
  if n.purpose_id is not null and not exists (select 1 from public.mkt_purposes where id = n.purpose_id and org_id = v_org) then raise exception 'finalidade inválida'; end if;
  if n.product_id is not null and not exists (select 1 from public.products where id = n.product_id and org_id = v_org) then raise exception 'produto inválido'; end if;
  if n.pipeline_id is not null and not exists (select 1 from public.pipelines where id = n.pipeline_id and org_id = v_org) then raise exception 'funil inválido'; end if;
  if n.unit_id is not null and not exists (select 1 from public.units where id = n.unit_id and org_id = v_org) then raise exception 'unidade inválida'; end if;
  if n.primary_result is not null and not exists (select 1 from public.mkt_event_types where key = n.primary_result) then raise exception 'resultado não suportado'; end if;
  -- classificada = frente + finalidade definidas (nada é inferido pelo nome). Remover a frente/finalidade devolve a "Aguardando classificação".
  n.state := case when n.front_id is not null and n.purpose_id is not null then 'classified' else 'pending' end;
  b := to_jsonb(cur) - 'updated_by' - 'updated_at' - 'org_id' - 'campaign_id'; a := to_jsonb(n) - 'updated_by' - 'updated_at' - 'org_id' - 'campaign_id';
  v_effect := private.mkt_class_effect(p_campaign, b, a);
  if p_dry_run or b = a then return jsonb_build_object('changed', b <> a, 'effect', case when b <> a then v_effect else 'Nenhuma alteração.' end, 'saved', false); end if;
  update public.mkt_campaign_class set state = n.state, include_in_hub = n.include_in_hub, include_in_reports = n.include_in_reports, front_id = n.front_id, purpose_id = n.purpose_id,
    product_id = n.product_id, pipeline_id = n.pipeline_id, unit_id = n.unit_id, primary_result = n.primary_result, updated_by = (select auth.uid()), updated_at = now() where campaign_id = p_campaign;
  insert into public.mkt_campaign_class_history (org_id, campaign_id, changed_by, before, after, effect) values (v_org, p_campaign, (select auth.uid()), b, a, v_effect);
  return jsonb_build_object('changed', true, 'effect', v_effect, 'saved', true, 'state', n.state);
end $$;

create or replace function public.mkt_class_history(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('at', h.changed_at, 'by', (select display_name from public.user_accounts ua where ua.user_id = h.changed_by), 'before', h.before, 'after', h.after, 'effect', h.effect) order by h.changed_at desc)
    from public.mkt_campaign_class_history h where h.org_id = v_org and h.campaign_id = p_campaign), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- ações explícitas sobre a atribuição (nada recalcula sozinho)
create or replace function public.mkt_attribution_recompute(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r record; n int := 0; v_ver int;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'período inválido (máximo de 366 dias)'; end if;
  select config_version into v_ver from public.mkt_settings where org_id = v_org;
  for r in select id from public.opportunities where org_id = v_org and (created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to loop
    perform private.mkt_attribute_opportunity(r.id, 'recompute', true); n := n + 1;
  end loop;
  for r in select s.id from public.sales s where s.org_id = v_org and s.status = 'confirmed' and (coalesce(s.sold_at, s.created_at) at time zone 'America/Sao_Paulo')::date between p_from and p_to loop
    perform private.mkt_attribute_sale(r.id, true);
  end loop;
  insert into public.mkt_attribution_log (org_id, run_by, kind, window_from, window_to, changed, config_version, note) values (v_org, (select auth.uid()), 'recompute', p_from, p_to, n, v_ver, 'regra atual aplicada ao período');
  return jsonb_build_object('recomputed', n, 'config_version', v_ver);
end $$;

-- cria toques a partir do que JÁ está gravado em formulários/quizzes (utm higienizado) — ação explícita e idempotente; não inventa dado que não existe
create or replace function public.mkt_history_backfill() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r record; n_t int := 0; n_a int := 0; v_before int;
begin
  select count(*) into v_before from public.mkt_touches where org_id = v_org;
  for r in select s.* , f.unit_id f_unit, (select '/' || pg.slug from public.pages pg where pg.id = s.page_id) path from public.form_submissions s join public.forms f on f.id = s.form_id where s.org_id = v_org loop
    perform private.mkt_touch_upsert(r.org_id, r.f_unit, r.person_id, r.opportunity_id, r.created_at, 'form', 'form:' || r.form_id::text, r.id, r.utm, r.referrer, r.path);
  end loop;
  for r in select * from public.quiz_leads where org_id = v_org loop
    perform private.mkt_touch_upsert(r.org_id, r.unit_id, r.person_id, r.opportunity_id, r.started_at, 'quiz', 'quiz:' || r.journey, r.id, r.utm, r.referrer, r.origin_path);
  end loop;
  select count(*) - v_before into n_t from public.mkt_touches where org_id = v_org;
  for r in select o.id from public.opportunities o where o.org_id = v_org and not exists (select 1 from public.mkt_attributions a where a.opportunity_id = o.id) loop
    perform private.mkt_attribute_opportunity(r.id, 'backfill'); n_a := n_a + 1;
  end loop;
  for r in select s.id from public.sales s where s.org_id = v_org and s.status = 'confirmed' and not exists (select 1 from public.mkt_sale_attributions x where x.sale_id = s.id) loop perform private.mkt_attribute_sale(r.id); end loop;
  insert into public.mkt_attribution_log (org_id, run_by, kind, changed, config_version, note) values (v_org, (select auth.uid()), 'backfill', n_t + n_a, (select config_version from public.mkt_settings where org_id = v_org), format('%s toque(s) e %s atribuição(ões) criados a partir do histórico gravado', n_t, n_a));
  return jsonb_build_object('touches_created', n_t, 'attributions_created', n_a);
end $$;

-- religa toques já gravados a campanhas importadas depois (por id; por nome só se exato e único). Só preenche toques SEM campanha ligada.
create or replace function public.mkt_touches_relink() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r record; n int := 0;
begin
  for r in select id from public.mkt_touches where org_id = v_org and campaign_id is null and platform in ('meta','google') and is_paid loop
    perform private.mkt_link_touch_campaign(r.id);
  end loop;
  select count(*) into n from public.mkt_touches where org_id = v_org and campaign_id is not null and campaign_link_basis is not null;
  insert into public.mkt_attribution_log (org_id, run_by, kind, changed, note) values (v_org, (select auth.uid()), 'relink', n, 'toques religados a campanhas importadas');
  return jsonb_build_object('linked_total', n);
end $$;

-- ---------------------------------------------------------------- atualizar agora: controle de frequência (consultado também pela Edge Function)
create or replace function public.mkt_refresh_state() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); v_min int; v_last timestamptz;
begin
  select manual_refresh_min_minutes into v_min from public.mkt_settings where org_id = v_org; v_min := coalesce(v_min, 15);
  select max(started_at) into v_last from public.mkt_sync_runs where org_id = v_org and kind = 'manual';
  return jsonb_build_object('min_minutes', v_min, 'last_manual_at', v_last, 'allowed', v_last is null or v_last < now() - make_interval(mins => v_min),
    'next_allowed_at', case when v_last is null then null else v_last + make_interval(mins => v_min) end);
end $$;

-- ---------------------------------------------------------------- SERVICE ROLE (Edge Function): execução, ingestão, cobertura
create or replace function public.mkt_run_start(p_org uuid, p_connection uuid, p_account uuid, p_kind text, p_from date, p_to date, p_user uuid, p_version text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- trava vencida (sem batimento há 20 min) é encerrada como erro e a execução seguinte pode começar
  update public.mkt_sync_runs set status = 'error', finished_at = now(), error_code = 'stale_lock', error_message = 'execução anterior sem resposta; liberada'
   where status = 'running' and heartbeat_at < now() - interval '20 minutes' and ((p_account is not null and account_id = p_account) or (p_account is null and account_id is null and connection_id = p_connection));
  begin
    insert into public.mkt_sync_runs (org_id, connection_id, account_id, kind, window_from, window_to, requested_by, api_version) values (p_org, p_connection, p_account, p_kind, p_from, p_to, p_user, p_version) returning id into v_id;
  exception when unique_violation then return null;                                            -- já há uma execução ativa: esta é descartada (idempotência/concorrência)
  end;
  return v_id;
end $$;
create or replace function public.mkt_run_heartbeat(p_run uuid, p_pages int, p_retries int) returns void language sql security definer set search_path = '' as $$
  update public.mkt_sync_runs set heartbeat_at = now(), pages = greatest(pages, coalesce(p_pages, 0)), retries = greatest(retries, coalesce(p_retries, 0)) where id = p_run and status = 'running'
$$;
create or replace function public.mkt_run_finish(p_run uuid, p_status text, p_rows int, p_error_code text, p_error_message text, p_days_ok date[], p_days_failed date[]) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.mkt_sync_runs;
begin
  if p_status not in ('ok','partial','error','skipped') then raise exception 'status inválido'; end if;
  select * into r from public.mkt_sync_runs where id = p_run; if r.id is null then raise exception 'execução não encontrada'; end if;
  update public.mkt_sync_runs set status = p_status, finished_at = now(), rows_written = coalesce(p_rows, 0), error_code = left(p_error_code, 60), error_message = left(p_error_message, 400) where id = p_run;
  if r.account_id is not null then
    -- dia coletado com sucesso = cobertura; falha NUNCA vira gasto zero (só marca o dia como falho, sem escrever linhas)
    insert into public.mkt_day_status (account_id, day, org_id, status, run_id) select r.account_id, d, r.org_id, 'ok', p_run from unnest(coalesce(p_days_ok, '{}')) d
      on conflict (account_id, day) do update set status = 'ok', run_id = excluded.run_id, collected_at = now();
    insert into public.mkt_day_status (account_id, day, org_id, status, run_id) select r.account_id, d, r.org_id, 'failed', p_run from unnest(coalesce(p_days_failed, '{}')) d
      on conflict (account_id, day) do update set status = case when public.mkt_day_status.status = 'ok' then 'ok' else 'failed' end, run_id = case when public.mkt_day_status.status = 'ok' then public.mkt_day_status.run_id else excluded.run_id end;
    if r.window_from is not null then perform private.mkt_resolve_overlap(r.account_id, r.window_from, r.window_to); end if;
  end if;
  if r.connection_id is not null then
    update public.mkt_connections set last_sync_at = now(), last_ok_at = case when p_status = 'ok' then now() else last_ok_at end,
      last_error = case when p_status in ('error','partial') then left(p_error_message, 300) else null end, last_error_at = case when p_status in ('error','partial') then now() else null end,
      status = case when p_error_code in ('auth_expired','auth_revoked') then 'reauth_required' when status in ('error') and p_status = 'ok' then 'active' else status end
     where id = r.connection_id;
  end if;
end $$;
-- upsert de entidades (campanhas/conjuntos/anúncios): objetivo e status ORIGINAIS ficam nas colunas da entidade; a classificação interna nasce "Aguardando"
create or replace function public.mkt_ingest_entities(p_run uuid, p_campaigns jsonb, p_adsets jsonb, p_ads jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare r public.mkt_sync_runs;
begin
  select * into r from public.mkt_sync_runs where id = p_run and status = 'running'; if r.id is null or r.account_id is null then raise exception 'execução inválida'; end if;
  insert into public.mkt_campaigns (org_id, account_id, external_id, name, platform_objective, platform_status, platform_created_at, platform_updated_at, last_seen_at)
    select r.org_id, r.account_id, x.external_id, x.name, x.objective, x.status, x.created_at, x.updated_at, now()
      from jsonb_to_recordset(coalesce(p_campaigns, '[]')) as x(external_id text, name text, objective text, status text, created_at timestamptz, updated_at timestamptz)
    on conflict (account_id, external_id) do update set name = excluded.name, platform_objective = excluded.platform_objective, platform_status = excluded.platform_status,
      platform_created_at = coalesce(excluded.platform_created_at, public.mkt_campaigns.platform_created_at), platform_updated_at = excluded.platform_updated_at, last_seen_at = now();
  insert into public.mkt_adsets (org_id, account_id, campaign_id, external_id, name, platform_status, last_seen_at)
    select r.org_id, r.account_id, c.id, x.external_id, x.name, x.status, now()
      from jsonb_to_recordset(coalesce(p_adsets, '[]')) as x(external_id text, campaign_external_id text, name text, status text)
      join public.mkt_campaigns c on c.account_id = r.account_id and c.external_id = x.campaign_external_id
    on conflict (account_id, external_id) do update set name = excluded.name, platform_status = excluded.platform_status, campaign_id = excluded.campaign_id, last_seen_at = now();
  insert into public.mkt_ads (org_id, account_id, campaign_id, adset_id, external_id, name, platform_status, creative_ref, creative_name, last_seen_at)
    select r.org_id, r.account_id, c.id, s.id, x.external_id, x.name, x.status, x.creative_ref, x.creative_name, now()
      from jsonb_to_recordset(coalesce(p_ads, '[]')) as x(external_id text, campaign_external_id text, adset_external_id text, name text, status text, creative_ref text, creative_name text)
      join public.mkt_campaigns c on c.account_id = r.account_id and c.external_id = x.campaign_external_id
      left join public.mkt_adsets s on s.account_id = r.account_id and s.external_id = x.adset_external_id
    on conflict (account_id, external_id) do update set name = excluded.name, platform_status = excluded.platform_status, campaign_id = excluded.campaign_id, adset_id = excluded.adset_id,
      creative_ref = excluded.creative_ref, creative_name = excluded.creative_name, last_seen_at = now();
end $$;
-- métricas diárias. level: campaign (canônico → mkt_spend_daily) | adset | ad (detalhe) | breakdown (kind/value). Idempotente: a chave inclui conta, entidade, dia (e fonte).
create or replace function public.mkt_ingest_metrics(p_run uuid, p_level text, p_rows jsonb, p_currency text, p_tz text, p_defs jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare r public.mkt_sync_runs; n int := 0;
begin
  select * into r from public.mkt_sync_runs where id = p_run and status = 'running'; if r.id is null or r.account_id is null then raise exception 'execução inválida'; end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'moeda ausente na resposta da plataforma'; end if;
  if p_level = 'campaign' then
    insert into public.mkt_spend_daily (org_id, account_id, campaign_id, day, source, currency, tz, spend, impressions, link_clicks, clicks_all, reported_results, reported_actions, metric_defs, api_version, run_id, collected_at)
      select r.org_id, r.account_id, c.id, x.day, 'api', p_currency, p_tz, x.spend, x.impressions, x.link_clicks, x.clicks_all, x.reported_results, x.reported_actions, p_defs, r.api_version, p_run, now()
        from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(campaign_external_id text, day date, spend numeric, impressions bigint, link_clicks bigint, clicks_all bigint, reported_results numeric, reported_actions jsonb)
        join public.mkt_campaigns c on c.account_id = r.account_id and c.external_id = x.campaign_external_id
      on conflict (org_id, account_id, campaign_id, day, source) do update set spend = excluded.spend, impressions = excluded.impressions, link_clicks = excluded.link_clicks, clicks_all = excluded.clicks_all,
        reported_results = excluded.reported_results, reported_actions = excluded.reported_actions, metric_defs = excluded.metric_defs, currency = excluded.currency, tz = excluded.tz, api_version = excluded.api_version,
        run_id = excluded.run_id, collected_at = now();
  elsif p_level in ('adset','ad') then
    insert into public.mkt_entity_daily (org_id, account_id, level, campaign_id, adset_id, ad_id, day, currency, spend, impressions, link_clicks, reported_results, run_id, collected_at)
      select r.org_id, r.account_id, p_level, c.id, case when p_level = 'adset' then s.id else a.adset_id end, case when p_level = 'ad' then a.id end, x.day, p_currency, x.spend, x.impressions, x.link_clicks, x.reported_results, p_run, now()
        from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(entity_external_id text, day date, spend numeric, impressions bigint, link_clicks bigint, reported_results numeric)
        left join public.mkt_adsets s on p_level = 'adset' and s.account_id = r.account_id and s.external_id = x.entity_external_id
        left join public.mkt_ads a on p_level = 'ad' and a.account_id = r.account_id and a.external_id = x.entity_external_id
        join public.mkt_campaigns c on c.id = coalesce(s.campaign_id, a.campaign_id)
       where (p_level = 'adset' and s.id is not null) or (p_level = 'ad' and a.id is not null)
      on conflict (account_id, level, coalesce(adset_id, ad_id), day) do update set spend = excluded.spend, impressions = excluded.impressions, link_clicks = excluded.link_clicks,
        reported_results = excluded.reported_results, currency = excluded.currency, run_id = excluded.run_id, collected_at = now();
  elsif p_level = 'breakdown' then
    insert into public.mkt_breakdown_daily (org_id, account_id, campaign_id, day, kind, value, currency, spend, impressions, link_clicks, run_id, collected_at)
      select r.org_id, r.account_id, c.id, x.day, x.kind, left(x.value, 60), p_currency, x.spend, x.impressions, x.link_clicks, p_run, now()
        from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(campaign_external_id text, day date, kind text, value text, spend numeric, impressions bigint, link_clicks bigint)
        join public.mkt_campaigns c on c.account_id = r.account_id and c.external_id = x.campaign_external_id where x.kind in ('publisher_platform','platform_position','device')
      on conflict (account_id, campaign_id, day, kind, value) do update set spend = excluded.spend, impressions = excluded.impressions, link_clicks = excluded.link_clicks, currency = excluded.currency, run_id = excluded.run_id, collected_at = now();
  else raise exception 'nível inválido'; end if;
  get diagnostics n = row_count; return n;
end $$;
-- descoberta de contas autorizadas: só insere/atualiza dados descritivos; NUNCA marca como selecionada
create or replace function public.mkt_accounts_upsert(p_connection uuid, p_accounts jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare c public.mkt_connections; n int;
begin
  select * into c from public.mkt_connections where id = p_connection; if c.id is null then raise exception 'conexão não encontrada'; end if;
  insert into public.mkt_ad_accounts (org_id, connection_id, platform, origin, external_id, name, currency, timezone, platform_status, login_customer_id, last_seen_at)
    select c.org_id, c.id, c.platform, 'api', x.external_id, x.name, upper(x.currency), x.timezone, x.status, x.login_customer_id, now()
      from jsonb_to_recordset(coalesce(p_accounts, '[]')) as x(external_id text, name text, currency text, timezone text, status text, login_customer_id text) where x.external_id is not null
    on conflict (org_id, platform, external_id) do update set name = excluded.name, currency = excluded.currency, timezone = excluded.timezone, platform_status = excluded.platform_status,
      login_customer_id = excluded.login_customer_id, last_seen_at = now(), connection_id = excluded.connection_id;
  get diagnostics n = row_count; return n;
end $$;
create or replace function public.mkt_connection_set_state(p_connection uuid, p_status text, p_error text, p_scopes text[], p_expires timestamptz, p_label text, p_version text, p_connected_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('disconnected','pending','active','error','reauth_required') then raise exception 'status inválido'; end if;
  update public.mkt_connections set status = p_status, last_error = left(p_error, 300), last_error_at = case when p_error is not null then now() end, granted_scopes = coalesce(p_scopes, granted_scopes),
    token_expires_at = p_expires, provider_user_label = coalesce(p_label, provider_user_label), api_version = coalesce(p_version, api_version),
    connected_by = coalesce(p_connected_by, connected_by), connected_at = case when p_status = 'active' and connected_at is null then now() else connected_at end,
    disconnected_at = case when p_status = 'disconnected' then now() else disconnected_at end where id = p_connection;
  if p_status = 'disconnected' then
    -- desconexão interrompe novas sincronizações; o histórico de gastos é preservado; as contas deixam de ser acompanhadas
    update public.mkt_ad_accounts set selected = false where connection_id = p_connection;
    delete from public.mkt_credentials where connection_id = p_connection;
  end if;
end $$;

-- ---------------------------------------------------------------- privilégios
do $$ declare f text; begin
  foreach f in array array[
    'mkt_config_get()','mkt_settings_set(jsonb)','mkt_front_save(uuid,text,text,int,boolean)','mkt_purpose_save(uuid,text,text,int,boolean)','mkt_connection_enable(text,boolean)','mkt_account_select(uuid,boolean,uuid)',
    'mkt_manual_account_create(text,text,text,text,uuid)','mkt_manual_campaign_create(uuid,text)','mkt_spend_manual_upsert(uuid,date,numeric,text,bigint,bigint,text,boolean)','mkt_spend_manual_delete(bigint)',
    'mkt_spend_manual_import(jsonb)','mkt_class_save(uuid,jsonb,boolean)','mkt_class_history(uuid)','mkt_attribution_recompute(date,date)','mkt_history_backfill()','mkt_touches_relink()','mkt_refresh_state()'] loop
    execute format('revoke all on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['mkt_run_start(uuid,uuid,uuid,text,date,date,uuid,text)','mkt_run_heartbeat(uuid,int,int)','mkt_run_finish(uuid,text,int,text,text,date[],date[])','mkt_ingest_entities(uuid,jsonb,jsonb,jsonb)',
    'mkt_ingest_metrics(uuid,text,jsonb,text,text,jsonb)','mkt_accounts_upsert(uuid,jsonb)','mkt_connection_set_state(uuid,text,text,text[],timestamptz,text,text,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f); execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function private.mkt_require_admin(), private.mkt_require_reader(), private.mkt_class_effect(uuid, jsonb, jsonb), private.mkt_resolve_overlap(uuid, date, date) from public, anon, authenticated;
