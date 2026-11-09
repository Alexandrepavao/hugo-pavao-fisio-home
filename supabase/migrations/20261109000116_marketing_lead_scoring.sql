-- HP Group Hub — 116 Marketing: LEAD SCORING de 0 a 100 (calculado na leitura, explicável, com pesos definidos pelo administrador).
--  • Só usa fatos OPERACIONAIS: origem rastreável, rapidez do contato, contato completo, quiz concluído (apenas o status, nunca as respostas), toques repetidos e andamento no CRM/Agenda.
--    NUNCA usa respostas de questionário, sintomas, diagnóstico, evolução clínica nem qualquer dado de saúde.
--  • Nota = base + soma dos pontos dos fatores presentes (positivos e negativos), limitada a 0–100. Cada lead mostra quais fatores pesaram (impulsionadores e detratores).
--  • A tela mostra a CONVERSÃO REAL por faixa (quente/morna/fria) no período: é associação observada, não prova de que a nota prevê venda.

create table public.mkt_score_settings (org_id uuid primary key references public.organizations(id) on delete cascade, base int not null default 20 check (base between 0 and 100),
  hot_min int not null default 70 check (hot_min between 1 and 100), warm_min int not null default 40 check (warm_min between 1 and 99), updated_at timestamptz not null default now(), check (warm_min < hot_min));
create table public.mkt_score_rules (org_id uuid not null references public.organizations(id) on delete cascade, factor text not null, enabled boolean not null default true, points int not null check (points between -50 and 50),
  param int check (param is null or param between 1 and 10080), primary key (org_id, factor));
alter table public.mkt_score_settings enable row level security; alter table public.mkt_score_rules enable row level security; revoke all on public.mkt_score_settings, public.mkt_score_rules from anon, authenticated;

create table public.mkt_score_factors (factor text primary key, label text not null, kind text not null check (kind in ('positive','negative')), param_label text, default_points int not null, default_param int, description text not null, position int not null);
insert into public.mkt_score_factors (factor, label, kind, param_label, default_points, default_param, description, position) values
  ('ad_identified', 'Anúncio identificado no link', 'positive', null, 5, null, 'O link trouxe o id do anúncio e ele foi importado: origem rastreável até o criativo.', 1),
  ('quick_response', 'Primeiro contato rápido', 'positive', 'minutos', 15, 60, 'Primeiro contato humano registrado em até N minutos da criação da oportunidade.', 2),
  ('slow_response', 'Sem contato após N horas', 'negative', 'horas', -15, 24, 'Nenhum contato humano registrado depois de N horas.', 3),
  ('contact_complete', 'E-mail e telefone/WhatsApp', 'positive', null, 10, null, 'Cadastro com e-mail e também telefone ou WhatsApp.', 4),
  ('quiz_completed', 'Quiz concluído', 'positive', null, 10, null, 'Concluiu o quiz (só o status; as respostas não entram na nota).', 5),
  ('repeat_touch', 'Mais de um toque', 'positive', null, 10, null, 'Voltou a interagir: dois ou mais formulários/quizzes.', 6),
  ('qualified_stage', 'Qualificado no funil', 'positive', null, 15, null, 'Chegou a etapa marcada como qualificação.', 7),
  ('scheduled', 'Atendimento agendado', 'positive', null, 15, null, 'Tem atendimento marcado.', 8),
  ('attended', 'Compareceu', 'positive', null, 10, null, 'Teve atendimento realizado.', 9),
  ('no_show', 'Faltou', 'negative', null, -15, null, 'Faltou a algum atendimento.', 10),
  ('lost', 'Oportunidade perdida', 'negative', null, -20, null, 'A oportunidade foi encerrada como perdida.', 11);
alter table public.mkt_score_factors enable row level security; create policy mkt_sf_read on public.mkt_score_factors for select to authenticated using (true);
revoke all on public.mkt_score_factors from anon; revoke insert, update, delete, truncate on public.mkt_score_factors from authenticated;

create or replace function private.mkt_score_seed(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mkt_score_settings (org_id) values (p_org) on conflict do nothing;
  insert into public.mkt_score_rules (org_id, factor, points, param) select p_org, f.factor, f.default_points, f.default_param from public.mkt_score_factors f on conflict do nothing;
end $$;
revoke all on function private.mkt_score_seed(uuid) from public, anon, authenticated;
select private.mkt_score_seed(id) from public.organizations;

create or replace function public.mkt_score_get() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader();
begin
  perform private.mkt_score_seed(v_org);
  return jsonb_build_object('settings', (select to_jsonb(s) - 'org_id' - 'updated_at' from public.mkt_score_settings s where org_id = v_org),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('factor', f.factor, 'label', f.label, 'kind', f.kind, 'param_label', f.param_label, 'description', f.description, 'enabled', r.enabled, 'points', r.points, 'param', r.param,
      'default_points', f.default_points, 'default_param', f.default_param) order by f.position), '[]') from public.mkt_score_factors f join public.mkt_score_rules r on r.factor = f.factor and r.org_id = v_org));
end $$;
create or replace function public.mkt_score_set(p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r jsonb; f public.mkt_score_factors; s public.mkt_score_settings;
begin
  perform private.mkt_score_seed(v_org); select * into s from public.mkt_score_settings where org_id = v_org;
  update public.mkt_score_settings set base = coalesce((p ->> 'base')::int, base), hot_min = coalesce((p ->> 'hot_min')::int, hot_min), warm_min = coalesce((p ->> 'warm_min')::int, warm_min), updated_at = now() where org_id = v_org;
  for r in select * from jsonb_array_elements(coalesce(p -> 'rules', '[]')) loop
    select * into f from public.mkt_score_factors where factor = r ->> 'factor'; if f.factor is null then raise exception 'fator desconhecido'; end if;
    if f.kind = 'positive' and (r ->> 'points')::int < 0 or f.kind = 'negative' and (r ->> 'points')::int > 0 then raise exception 'fator % deve ter pontos %', f.label, case f.kind when 'positive' then 'positivos' else 'negativos' end; end if;
    update public.mkt_score_rules set enabled = coalesce((r ->> 'enabled')::boolean, enabled), points = coalesce((r ->> 'points')::int, points), param = case when f.param_label is null then null else coalesce((r ->> 'param')::int, param) end where org_id = v_org and factor = f.factor;
  end loop;
end $$;

-- pontuação dos leads atribuídos a campanhas no escopo, criados no período
create or replace function public.mkt_lead_scores(p_from date, p_to date, p_filters jsonb default '{}', p_limit int default 200) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); u uuid[]; st public.mkt_score_settings; res jsonb; v_total int; lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'período inválido'; end if;
  perform private.mkt_score_seed(v_org); select * into st from public.mkt_score_settings where org_id = v_org; u := private.mkt_units_scope(p_filters);
  with o as materialized (select * from private.mkt_opp_rows(p_filters, u) where private.mkt_day(created_at) between p_from and p_to),
  ap as materialized (select * from private.mkt_appt_rows(p_filters, u)), sl as materialized (select distinct opp_id from private.mkt_sale_rows(p_filters, u)),
  rl as (select r.factor, r.enabled, r.points, r.param from public.mkt_score_rules r where r.org_id = v_org),
  base as (
    select o.opp_id, o.person_id, o.created_at, o.status, o.campaign_id, o.qualified_at, o.first_response_at,
      (select t.ad_id is not null from public.mkt_attributions a join public.mkt_touches t on t.id = a.touch_id where a.opportunity_id = o.opp_id) f_ad,
      (o.first_response_at is not null and extract(epoch from (o.first_response_at - o.created_at)) / 60 <= (select param from rl where factor = 'quick_response')) f_quick,
      (o.first_response_at is null and o.status = 'open' and now() - o.created_at > make_interval(hours => (select param from rl where factor = 'slow_response'))) f_slow,
      (exists (select 1 from public.person_contacts c where c.person_id = o.person_id and c.type::text = 'email') and exists (select 1 from public.person_contacts c where c.person_id = o.person_id and c.type::text in ('phone','whatsapp'))) f_contact,
      exists (select 1 from public.quiz_leads q where q.person_id = o.person_id and q.status = 'completed') f_quiz,
      ((select count(*) from public.mkt_touches t where t.person_id = o.person_id and t.touched_at <= now()) >= 2) f_repeat,
      (o.qualified_at is not null) f_qual, exists (select 1 from ap where ap.opp_id = o.opp_id and ap.status <> 'rescheduled') f_sched, exists (select 1 from ap where ap.opp_id = o.opp_id and ap.status = 'attended') f_att,
      exists (select 1 from ap where ap.opp_id = o.opp_id and ap.status = 'no_show') f_ns, (o.status = 'lost') f_lost, exists (select 1 from sl where sl.opp_id = o.opp_id) sold
    from o),
  fx as (
    select b.*, x.factor, x.pts from base b cross join lateral (values ('ad_identified', b.f_ad), ('quick_response', b.f_quick), ('slow_response', b.f_slow), ('contact_complete', b.f_contact), ('quiz_completed', b.f_quiz), ('repeat_touch', b.f_repeat),
      ('qualified_stage', b.f_qual), ('scheduled', b.f_sched), ('attended', b.f_att), ('no_show', b.f_ns), ('lost', b.f_lost)) v(factor, hit)
      join rl on rl.factor = v.factor and rl.enabled and coalesce(v.hit, false) cross join lateral (select rl.factor, rl.points pts) x),
  sc as (select b.opp_id, b.person_id, b.created_at, b.status, b.campaign_id, b.sold, least(100, greatest(0, st.base + coalesce((select sum(fx.pts) from fx where fx.opp_id = b.opp_id), 0))) score,
           (select coalesce(jsonb_agg(jsonb_build_object('factor', fx.factor, 'label', (select label from public.mkt_score_factors where factor = fx.factor), 'points', fx.pts) order by abs(fx.pts) desc), '[]') from fx where fx.opp_id = b.opp_id) factors from base b),
  bd as (select sc.*, case when sc.score >= st.hot_min then 'hot' when sc.score >= st.warm_min then 'warm' else 'cold' end band from sc)
  select jsonb_build_object('total', (select count(*) from bd), 'avg_score', (select round(avg(score), 1) from bd),
    'bands', (select coalesce(jsonb_object_agg(band, jsonb_build_object('n', n, 'sold', s, 'conversion_pct', case when n > 0 then round(100.0 * s / n, 1) end)), '{}') from (select band, count(*) n, count(*) filter (where sold) s from bd group by band) q),
    'distribution', (select coalesce(jsonb_agg(jsonb_build_object('from', b * 10, 'to', least(b * 10 + 9, 100), 'n', coalesce(c.n, 0)) order by b), '[]') from generate_series(0, 10) b left join (select least(score / 10, 10) bk, count(*) n from bd group by 1) c on c.bk = b),
    'factor_hits', (select coalesce(jsonb_agg(jsonb_build_object('factor', factor, 'label', (select label from public.mkt_score_factors where factor = fx2.factor), 'points', pts, 'count', n) order by n desc), '[]') from (select factor, pts, count(*) n from fx group by factor, pts) fx2),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object('opp_id', l.opp_id, 'person_id', l.person_id, 'name', (select full_name from public.people where id = l.person_id), 'score', l.score, 'band', l.band, 'factors', l.factors,
        'campaign', (select name from public.mkt_campaigns where id = l.campaign_id), 'created_at', l.created_at, 'status', l.status, 'sold', l.sold) order by l.score desc, l.created_at desc), '[]')
        from (select * from bd order by score desc, created_at desc limit lim) l),
    'settings', jsonb_build_object('base', st.base, 'hot_min', st.hot_min, 'warm_min', st.warm_min),
    'notes', jsonb_build_array('A nota usa só fatos operacionais (origem, rapidez, contato completo, status do quiz, andamento no CRM/Agenda). Respostas de questionário e qualquer dado de saúde NÃO entram.',
      'A conversão por faixa é a observada no período: mostra associação, não prova que a nota prevê venda.')) into res;
  return res;
end $$;

do $$ declare f text; begin
  foreach f in array array['mkt_score_get()','mkt_score_set(jsonb)','mkt_lead_scores(date,date,jsonb,int)'] loop
    execute format('revoke all on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
