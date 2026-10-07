-- HP Group Hub — 043 Metas comerciais do CRM (Minha meta / Time). Feature nova (schema não existia antes).
-- "Ritmo do dia" do CRM Pro de referência usa contagem de conversas de WhatsApp como unidade de ritmo — HP não
-- tem log de mensagens (ver Conversas/Disparo, bloqueados por falta de provedor real), então o ritmo aqui é
-- calculado sobre negócios fechados (dado real que HP já tem), não sobre conversas (dado que HP não tem).

create table public.crm_goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,                              -- sempre o primeiro dia do mês
  target_value_cents bigint not null check (target_value_cents >= 0),
  expected_conversion_rate numeric not null default 20 check (expected_conversion_rate between 0 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, period_start)
);
create trigger crm_goals_touch before update on public.crm_goals for each row execute function private.touch_updated_at();

alter table public.crm_goals enable row level security;
grant select, insert, update on public.crm_goals to authenticated;

-- leitura: o próprio dono da meta, ou quem vê o time (manager/ops_admin/unit_manager)
create policy crm_goals_read on public.crm_goals for select to authenticated
  using (private.in_org(org_id) and (user_id = (select auth.uid()) or private.crm_is_team_viewer()));
create policy crm_goals_write on public.crm_goals for insert to authenticated
  with check (private.in_org(org_id) and private.crm_is_team_viewer());
create policy crm_goals_update on public.crm_goals for update to authenticated
  using (private.in_org(org_id) and private.crm_is_team_viewer()) with check (private.in_org(org_id));

-- Progresso da meta de um usuário num mês: valor vendido (ganho), % da meta, ticket médio, negócios
-- necessários pro restante, dias úteis restantes no mês e ritmo necessário (R$/dia útil). Sem "conversas"
-- (HP não rastreia mensagens) — só dados que o sistema realmente tem.
create or replace function public.crm_goal_progress(p_user uuid default null, p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
  v_month date := coalesce(date_trunc('month', coalesce(p_month, current_date))::date, current_date);
  v_month_end date := (v_month + interval '1 month' - interval '1 day')::date;
  v_goal record;
  v_won_value bigint; v_won_n int; v_avg_ticket numeric;
  v_business_days_left int; v_deals_needed int; v_daily_pace_cents bigint;
begin
  if v_user <> (select auth.uid()) and not private.crm_is_team_viewer() then
    raise exception 'sem permissão para ver a meta de outra pessoa' using errcode = '42501';
  end if;

  select * into v_goal from public.crm_goals where user_id = v_user and period_start = v_month
    and org_id = private.current_org() limit 1;

  select coalesce(sum(value_cents), 0), count(*) into v_won_value, v_won_n
    from public.opportunities where owner_user_id = v_user and status = 'won' and closed_at >= v_month::timestamptz and closed_at < (v_month_end + 1)::timestamptz;
  v_avg_ticket := case when v_won_n > 0 then v_won_value::numeric / v_won_n else 5000 * 100 end;  -- fallback: R$5.000 (mesmo fallback do CRM de referência)

  -- dias úteis restantes (seg-sex) entre hoje e o fim do mês, incluindo hoje
  select count(*) into v_business_days_left from generate_series(greatest(current_date, v_month), v_month_end, interval '1 day') d
    where extract(isodow from d) < 6;
  v_business_days_left := greatest(v_business_days_left, 1);

  if v_goal is null then
    return jsonb_build_object('has_goal', false, 'month', v_month, 'won_value_cents', v_won_value, 'won_deals', v_won_n, 'avg_ticket_cents', round(v_avg_ticket));
  end if;

  v_deals_needed := ceil(greatest(0, v_goal.target_value_cents - v_won_value) / v_avg_ticket);
  v_daily_pace_cents := ceil(greatest(0, v_goal.target_value_cents - v_won_value)::numeric / v_business_days_left);

  return jsonb_build_object(
    'has_goal', true, 'month', v_month, 'target_value_cents', v_goal.target_value_cents,
    'won_value_cents', v_won_value, 'won_deals', v_won_n, 'avg_ticket_cents', round(v_avg_ticket),
    'progress_pct', case when v_goal.target_value_cents > 0 then round(least(100, v_won_value * 100.0 / v_goal.target_value_cents), 1) else 100 end,
    'remaining_value_cents', greatest(0, v_goal.target_value_cents - v_won_value),
    'deals_needed', v_deals_needed, 'business_days_left', v_business_days_left, 'daily_pace_cents', v_daily_pace_cents,
    'expected_conversion_rate', v_goal.expected_conversion_rate
  );
end $$;

grant execute on function public.crm_goal_progress(uuid, date) to authenticated;

-- Retrato do time (só quem vê o time): meta, vendido, % do mês, ritmo diário necessário, por usuário —
-- mesma base do crm_goal_progress, mas pra todo mundo com meta cadastrada na unidade/org visível ao chamador.
create or replace function public.crm_team_snapshot(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date := coalesce(date_trunc('month', coalesce(p_month, current_date))::date, current_date);
  v_org uuid := private.current_org();
  v_row record; v_out jsonb := '[]'::jsonb;
begin
  if not private.crm_is_team_viewer() then raise exception 'sem permissão para ver o time' using errcode = '42501'; end if;
  for v_row in
    select g.user_id, ua.display_name, g.target_value_cents
    from public.crm_goals g
    join public.user_accounts ua on ua.user_id = g.user_id
    where g.org_id = v_org and g.period_start = v_month
    order by ua.display_name
  loop
    v_out := v_out || jsonb_build_array(public.crm_goal_progress(v_row.user_id, v_month) || jsonb_build_object('user_id', v_row.user_id, 'name', coalesce(v_row.display_name, '—')));
  end loop;
  return v_out;
end $$;

grant execute on function public.crm_team_snapshot(date) to authenticated;
