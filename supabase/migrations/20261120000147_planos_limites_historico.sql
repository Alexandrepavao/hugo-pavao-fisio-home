-- HP Group Hub — 147 Planos, assinatura por organização, limites e histórico (Dev; white label).
-- Completa o que já existia (migration 135) SEM inventar preço e SEM cobrança: o plano da PLATAFORMA (produto) continua separado do financeiro da clínica.
--  · limites com três estados distintos: NÃO CONFIGURADO (chave ausente), ILIMITADO (valor nulo explícito) e ZERO (número 0 = nenhuma criação nova quando a imposição está ligada);
--  · associar organização a um plano e ajustar assinatura (estado, imposição, exceções de limite) com histórico antes/depois;
--  · histórico de alterações de plano e de assinatura (platform_history), com o valor anterior e o novo;
--  · limite de unidades/profissionais seguro sob requisições SIMULTÂNEAS (trava por organização+métrica: duas criações juntas não furam o limite);
--  · validação de limites e de plano (números inteiros não negativos; chaves conhecidas).
create or replace function private.limits_valid(p jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare e record;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  for e in select * from jsonb_each(p) loop
    if e.key not in ('max_staff_users', 'max_professionals', 'max_units', 'max_active_patients', 'storage_mb', 'external') then return false; end if;
    if e.key = 'external' then if jsonb_typeof(e.value) not in ('object', 'null') then return false; end if;
    elsif jsonb_typeof(e.value) = 'null' then null;                                                        -- ilimitado
    elsif jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0 or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric) then return false;
    end if;
  end loop;
  return true;
end $$;

-- estados de limite: nao_configurado · ilimitado · zero · ok · perto · acima
create or replace function private.org_limits_status(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u jsonb := private.org_usage(p_org); l jsonb := coalesce(private.org_limits(p_org), '{}'); r jsonb := '[]'; m record; v numeric; lim numeric; st text;
begin
  for m in select * from (values ('staff_users', 'max_staff_users'), ('professionals', 'max_professionals'), ('units', 'max_units'), ('active_patients', 'max_active_patients')) x(metric, lim) loop
    v := (u ->> m.metric)::numeric;
    if not (l ? m.lim) then st := 'nao_configurado'; lim := null;
    elsif jsonb_typeof(l -> m.lim) = 'null' then st := 'ilimitado'; lim := null;
    else lim := (l ->> m.lim)::numeric;
      st := case when lim = 0 and v = 0 then 'zero' when v > lim then 'acima' when lim > 0 and v >= 0.8 * lim then 'perto' else 'ok' end;
    end if;
    r := r || jsonb_build_array(jsonb_build_object('metric', m.metric, 'value', v, 'limit', lim, 'state', st));
  end loop;
  return jsonb_build_object('usage', u, 'limits', r, 'enforcement', (select enforcement from public.org_subscriptions where org_id = p_org), 'plan', (select plan_key from public.org_subscriptions where org_id = p_org),
    'note', 'Contagens de uso, não custo financeiro. Excedente não é cobrado automaticamente; limites nunca apagam dados nem bloqueiam histórico/exportação. "Não configurado" = sem limite definido no plano; "ilimitado" = definido como sem teto; "zero" = definido como nenhum.');
end $$;

-- bloqueio de NOVAS criações (só com imposição 'block_new'), seguro sob concorrência: a contagem e a inserção da mesma organização/métrica são serializadas
create or replace function private.limit_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid := new.org_id; v_enf text; v_lim jsonb; v_val numeric; v_metric text := tg_argv[0]; v_key text := tg_argv[1];
begin
  select enforcement into v_enf from public.org_subscriptions where org_id = v_org; if v_enf is distinct from 'block_new' then return new; end if;
  v_lim := private.org_limits(v_org) -> v_key; if v_lim is null or jsonb_typeof(v_lim) <> 'number' then return new; end if;      -- não configurado ou ilimitado: nada a impor
  perform pg_advisory_xact_lock(hashtextextended('limit:' || v_org::text || ':' || v_metric, 0));
  v_val := case v_metric when 'units' then (select count(*) from public.units where org_id = v_org and coalesce(active, true))
                         when 'professionals' then (select count(*) from public.professionals where org_id = v_org and active) end;
  if v_val >= (v_lim #>> '{}')::numeric then raise exception 'limite do plano atingido (%): novas criações estão bloqueadas; histórico e exportação continuam disponíveis', v_key using errcode = 'P0011'; end if;
  return new;
end $$;

-- plano: criar/editar com validação e histórico (antes/depois). Não existe preço padrão e nenhuma cobrança é gerada.
create or replace function public.platform_plan_save(p_key text, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; v_allowed text[] := array['name', 'description', 'status', 'implementation_fee_cents', 'monthly_fee_cents', 'included_modules', 'limits']; v_before jsonb; v_after jsonb;
begin
  perform private.require_platform_admin();
  if p_key !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'chave inválida'; end if;
  for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_allowed)) then raise exception 'campo não permitido: %', k; end if; end loop;
  if p_patch ? 'limits' and not private.limits_valid(p_patch -> 'limits') then raise exception 'limites inválidos (use números inteiros não negativos, nulo para ilimitado, e só chaves conhecidas)'; end if;
  if p_patch ? 'included_modules' and exists (select 1 from jsonb_array_elements_text(p_patch -> 'included_modules') x where not exists (select 1 from public.platform_modules m where m.key = x)) then raise exception 'módulo incluído desconhecido'; end if;
  if p_patch ? 'status' and (p_patch ->> 'status') not in ('draft', 'active', 'retired') then raise exception 'estado de plano inválido'; end if;
  select to_jsonb(p) into v_before from public.platform_plans p where p.key = p_key;
  insert into public.platform_plans (key, name) values (p_key, coalesce(p_patch ->> 'name', p_key)) on conflict (key) do nothing;
  update public.platform_plans p set name = coalesce(p_patch ->> 'name', p.name), description = case when p_patch ? 'description' then p_patch ->> 'description' else p.description end, status = coalesce(p_patch ->> 'status', p.status),
      implementation_fee_cents = case when p_patch ? 'implementation_fee_cents' then nullif(p_patch ->> 'implementation_fee_cents', '')::bigint else p.implementation_fee_cents end,
      monthly_fee_cents = case when p_patch ? 'monthly_fee_cents' then nullif(p_patch ->> 'monthly_fee_cents', '')::bigint else p.monthly_fee_cents end,
      included_modules = case when p_patch ? 'included_modules' then array(select jsonb_array_elements_text(p_patch -> 'included_modules')) else p.included_modules end,
      limits = case when p_patch ? 'limits' then p_patch -> 'limits' else p.limits end, version = p.version + 1, updated_at = now() where p.key = p_key;
  select to_jsonb(p) into v_after from public.platform_plans p where p.key = p_key;
  perform private.platform_audit('plan.save', null, 'plan', p_key, jsonb_build_object('before', v_before, 'after', v_after));
  return v_after;
end $$;

-- assinatura da organização: associar a um plano, estado, imposição e exceções de limite — com histórico
create or replace function public.platform_subscription_set(p_org uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; v_allowed text[] := array['plan_key', 'status', 'enforcement', 'limits_override', 'implementation_status', 'notes']; v_before jsonb; v_after jsonb;
begin
  perform private.require_platform_admin();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'organização não encontrada'; end if;
  for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_allowed)) then raise exception 'campo não permitido: %', k; end if; end loop;
  if p_patch ? 'plan_key' and not exists (select 1 from public.platform_plans where key = p_patch ->> 'plan_key') then raise exception 'plano não encontrado'; end if;
  if p_patch ? 'limits_override' and not private.limits_valid(p_patch -> 'limits_override') then raise exception 'limites inválidos'; end if;
  if p_patch ? 'status' and (p_patch ->> 'status') not in ('trial', 'active', 'suspended', 'cancelled') then raise exception 'estado inválido'; end if;
  if p_patch ? 'enforcement' and (p_patch ->> 'enforcement') not in ('warn', 'block_new') then raise exception 'imposição inválida'; end if;
  if p_patch ? 'implementation_status' and (p_patch ->> 'implementation_status') not in ('pending', 'in_progress', 'done') then raise exception 'implantação inválida'; end if;
  select to_jsonb(s) into v_before from public.org_subscriptions s where s.org_id = p_org;
  if v_before is null and not (p_patch ? 'plan_key') then raise exception 'organização sem assinatura: informe o plano'; end if;
  insert into public.org_subscriptions (org_id, plan_key) values (p_org, coalesce(p_patch ->> 'plan_key', 'essencial')) on conflict (org_id) do nothing;
  update public.org_subscriptions s set plan_key = coalesce(p_patch ->> 'plan_key', s.plan_key), status = coalesce(p_patch ->> 'status', s.status), enforcement = coalesce(p_patch ->> 'enforcement', s.enforcement),
      limits_override = case when p_patch ? 'limits_override' then p_patch -> 'limits_override' else s.limits_override end, implementation_status = coalesce(p_patch ->> 'implementation_status', s.implementation_status),
      notes = case when p_patch ? 'notes' then left(p_patch ->> 'notes', 500) else s.notes end, updated_at = now() where s.org_id = p_org;
  select to_jsonb(s) into v_after from public.org_subscriptions s where s.org_id = p_org;
  perform private.platform_audit('subscription.set', p_org, 'subscription', p_org::text, jsonb_build_object('before', v_before, 'after', v_after));
  return v_after;
end $$;

create or replace function public.platform_org_subscription(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select jsonb_build_object('subscription', to_jsonb(s), 'plan', jsonb_build_object('key', p.key, 'name', p.name, 'status', p.status, 'limits', p.limits, 'included_modules', p.included_modules))
            from public.org_subscriptions s join public.platform_plans p on p.key = s.plan_key where s.org_id = p_org);
end $$;

-- histórico de alterações: plano (por chave) ou assinatura (por organização); mostra antes e depois
create or replace function public.platform_history(p_type text, p_id text, p_limit int default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  if p_type not in ('plan', 'subscription') then raise exception 'tipo inválido'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'before', a.details -> 'before', 'after', a.details -> 'after') order by a.id desc)
                     from (select * from public.platform_audit where entity_type = p_type and entity_id = p_id and action in ('plan.save', 'subscription.set') order by id desc limit least(coalesce(p_limit, 50), 200)) a), '[]'::jsonb);
end $$;

revoke all on function private.limits_valid(jsonb), private.org_limits_status(uuid), private.limit_guard() from public, anon, authenticated;
revoke all on function public.platform_plan_save(text, jsonb), public.platform_subscription_set(uuid, jsonb), public.platform_org_subscription(uuid), public.platform_history(text, text, int) from public, anon;
grant execute on function public.platform_plan_save(text, jsonb), public.platform_subscription_set(uuid, jsonb), public.platform_org_subscription(uuid), public.platform_history(text, text, int) to authenticated;
