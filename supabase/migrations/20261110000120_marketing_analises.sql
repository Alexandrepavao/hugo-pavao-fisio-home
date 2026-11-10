-- HP Group Hub — 120 Marketing: Análises (entender o porquê dos números).
-- Uma só função de leitura, public.mkt_analytics(período, filtros), sempre por GRUPO DE LEADS (os leads captados no período, acompanhados até hoje):
--  · tempo até cada etapa (contato, agendamento, comparecimento, venda), geral e por campanha, e a curva acumulada de quanto tempo os leads levam (só leads com tempo de vida suficiente em cada ponto)
--  · totais do grupo (investimento, receita vendida, recebido líquido de estorno, vendas) para custo por lead, custo por venda, ROAS e ticket médio
--  · onde os leads se perdem (etapa a etapa) e os motivos de perda mais citados
--  · qualidade por campanha (custo por lead, custo por venda, conversão lead → venda, retorno)
--  · retorno por região (zona de São Paulo capital ou cidade)
--  · dia da semana e faixa de horário (chegada de leads e tempo de primeira resposta)
--  · retorno por mês de captação: quanto cada grupo mensal já pagou em relação ao que custou
-- Só LEITURA: não cria tabela, não altera dado. Mesma fonte dos cartões (private.mkt_events), mesma permissão e mesmo isolamento por organização/unidade.
-- Contagem por PESSOA distinta (um lead = uma pessoa, na primeira oportunidade atribuída do período).

create or replace function public.mkt_analytics(p_from date, p_to date, p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); u uuid[]; cur text; res jsonb; v_first_month date;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'período inválido'; end if;
  u := private.mkt_units_scope(p_filters);
  cur := coalesce((select reporting_currency from public.mkt_settings where org_id = v_org), 'BRL');
  v_first_month := greatest((date_trunc('month', p_from::timestamp))::date, ((date_trunc('month', p_to::timestamp)) - interval '11 months')::date);

  with sc as materialized (select * from private.mkt_scope_campaigns(p_filters, u)),
  ev as materialized (select e.kind, e.rec_id, e.person_id, e.opp_id, e.ev_at, e.cents, e.campaign_id from private.mkt_events(null, p_from, p_to, p_filters, 'cohort', u) e where e.person_id is not null),
  -- o grupo: um lead por pessoa
  op as materialized (select person_id, opp_id, campaign_id, ev_at created_at from ev where kind = 'lead' and ev_at is not null),
  -- primeira vez em que cada pessoa do grupo atingiu cada etapa
  st as materialized (select e.person_id, e.kind, min(e.ev_at) at from ev e join op on op.person_id = e.person_id where e.kind in ('contacted', 'scheduled', 'attended', 'sold') and e.ev_at is not null group by 1, 2),
  tmk as materialized (select st.person_id, st.kind, op.campaign_id, op.created_at, greatest(0, extract(epoch from (st.at - op.created_at)) / 86400.0) d from st join op on op.person_id = st.person_id),
  money as materialized (select e.person_id, coalesce(sum(e.cents) filter (where e.kind = 'sale'), 0) sold, coalesce(sum(e.cents) filter (where e.kind = 'payment'), 0) received from ev e join op on op.person_id = e.person_id group by 1),
  spend as materialized (select sd.campaign_id, sum(sd.spend) s from public.mkt_spend_daily sd join sc on sc.campaign_id = sd.campaign_id
                          where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to group by 1),
  -- ---------------- 1) tempo até cada etapa
  t_all as (select coalesce(jsonb_object_agg(kind, jsonb_build_object('n', n, 'median_days', md, 'avg_days', av)), '{}') j
              from (select kind, count(*) n, round((percentile_cont(0.5) within group (order by d))::numeric, 1) md, round(avg(d)::numeric, 1) av from tmk group by kind) x),
  -- curva acumulada: dos leads com pelo menos k dias de vida, quantos já chegaram à etapa em até k dias (cada ponto só usa leads “maduros” para não penalizar os recentes)
  curve as (select coalesce(jsonb_object_agg(kind, pts), '{}') j from (
              select kd.kind, jsonb_agg(jsonb_build_object('day', ks.k, 'n', (select count(*) from tmk t where t.kind = kd.kind and t.d <= ks.k and t.created_at <= now() - make_interval(secs => (ks.k * 86400)::double precision)),
                       'base', (select count(*) from op where op.created_at <= now() - make_interval(secs => (ks.k * 86400)::double precision))) order by ks.k) pts
                from (values ('contacted'), ('scheduled'), ('attended'), ('sold')) kd(kind)
                cross join (select unnest(array[0.25, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60]::numeric[]) k) ks group by kd.kind) z),
  tot as (select jsonb_build_object('spend', (select sum(s) from spend), 'revenue', (select coalesce(sum(sold), 0) from money) / 100.0, 'received', (select coalesce(sum(received), 0) from money) / 100.0,
                                    'sales', (select count(*) from ev e join op on op.person_id = e.person_id where e.kind = 'sale')) j),
  t_camp as (select coalesce(jsonb_agg(r order by (r ->> 'leads')::int desc, r ->> 'name'), '[]') j from (
              select jsonb_build_object('campaign_id', c.id, 'name', c.name, 'platform', sc.platform, 'leads', o.n,
                       'stages', coalesce((select jsonb_object_agg(z.kind, jsonb_build_object('n', z.n, 'median_days', z.md))
                                             from (select kind, count(*) n, round((percentile_cont(0.5) within group (order by d))::numeric, 1) md from tmk where tmk.campaign_id = o.campaign_id group by kind) z), '{}'::jsonb)) r
                from (select campaign_id, count(*) n from op where campaign_id is not null group by 1) o join public.mkt_campaigns c on c.id = o.campaign_id join sc on sc.campaign_id = c.id order by o.n desc, c.name limit 15) q),
  -- ---------------- 2) onde se perdem
  d_all as (select jsonb_build_object('leads', (select count(*) from op), 'contacted', (select count(*) from st where kind = 'contacted'), 'scheduled', (select count(*) from st where kind = 'scheduled'),
                                       'attended', (select count(*) from st where kind = 'attended'), 'sold', (select count(*) from st where kind = 'sold')) j),
  d_camp as (select coalesce(jsonb_agg(r order by (r ->> 'leads')::int desc, r ->> 'name'), '[]') j from (
              select jsonb_build_object('campaign_id', c.id, 'name', c.name, 'platform', sc.platform, 'leads', o.n,
                       'contacted', (select count(*) from st join op o2 on o2.person_id = st.person_id where st.kind = 'contacted' and o2.campaign_id = o.campaign_id),
                       'scheduled', (select count(*) from st join op o2 on o2.person_id = st.person_id where st.kind = 'scheduled' and o2.campaign_id = o.campaign_id),
                       'attended', (select count(*) from st join op o2 on o2.person_id = st.person_id where st.kind = 'attended' and o2.campaign_id = o.campaign_id),
                       'sold', (select count(*) from st join op o2 on o2.person_id = st.person_id where st.kind = 'sold' and o2.campaign_id = o.campaign_id)) r
                from (select campaign_id, count(*) n from op where campaign_id is not null group by 1) o join public.mkt_campaigns c on c.id = o.campaign_id join sc on sc.campaign_id = c.id order by o.n desc, c.name limit 15) q),
  lost as (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc, reason), '[]') j from (
              select coalesce(lr.name, 'Sem motivo informado') reason, count(*) n
                from op join public.opportunities o on o.id = op.opp_id and o.status = 'lost' left join public.loss_reasons lr on lr.id = o.lost_reason_id group by 1 order by 2 desc, 1 limit 6) x),
  lost_n as (select count(*) n from op join public.opportunities o on o.id = op.opp_id and o.status = 'lost'),
  -- ---------------- 3) qualidade por campanha
  qual as (select coalesce(jsonb_agg(r order by (r ->> 'leads')::int desc, r ->> 'name'), '[]') j from (
              select jsonb_build_object('campaign_id', c.id, 'name', c.name, 'platform', sc.platform, 'leads', o.n, 'spend', sp.s,
                       'attended', (select count(*) from st join op o2 on o2.person_id = st.person_id where st.kind = 'attended' and o2.campaign_id = o.campaign_id),
                       'sold', (select count(*) from st join op o2 on o2.person_id = st.person_id where st.kind = 'sold' and o2.campaign_id = o.campaign_id),
                       'revenue', coalesce((select sum(m.sold) from money m join op o2 on o2.person_id = m.person_id where o2.campaign_id = o.campaign_id), 0) / 100.0) r
                from (select campaign_id, count(*) n from op where campaign_id is not null group by 1) o join public.mkt_campaigns c on c.id = o.campaign_id join sc on sc.campaign_id = c.id left join spend sp on sp.campaign_id = c.id
               order by o.n desc, c.name limit 20) q),
  -- ---------------- 4) região
  rg as materialized (select op.person_id,
                        case when pe.zone is not null then 'zone:' || pe.zone when nullif(btrim(coalesce(pe.city, '')), '') is not null then 'city:' || lower(btrim(pe.city)) || '|' || coalesce(upper(pe.state_uf), '') else 'none' end k,
                        case when pe.zone is not null then 'zone' when nullif(btrim(coalesce(pe.city, '')), '') is not null then 'city' else 'none' end kind,
                        case pe.zone when 'sul' then 'Zona Sul' when 'norte' then 'Zona Norte' when 'leste' then 'Zona Leste' when 'oeste' then 'Zona Oeste' when 'centro' then 'Centro (SP)'
                                     else case when nullif(btrim(coalesce(pe.city, '')), '') is not null then btrim(pe.city) || coalesce(' / ' || upper(pe.state_uf), '') else 'Sem localização' end end label
                        from op join public.people pe on pe.id = op.person_id),
  reg as (select coalesce(jsonb_agg(r order by (r ->> 'leads')::int desc, r ->> 'label'), '[]') j from (
              select jsonb_build_object('key', x.k, 'kind', min(x.kind), 'label', (array_agg(x.label order by x.label collate "C"))[1], 'leads', count(*),
                       'scheduled', count(*) filter (where x.sch), 'attended', count(*) filter (where x.att), 'sold', count(*) filter (where x.sld), 'revenue', coalesce(sum(x.sold), 0) / 100.0) r
                from (select rg.*, exists (select 1 from st where st.person_id = rg.person_id and st.kind = 'scheduled') sch, exists (select 1 from st where st.person_id = rg.person_id and st.kind = 'attended') att,
                             exists (select 1 from st where st.person_id = rg.person_id and st.kind = 'sold') sld, coalesce((select m.sold from money m where m.person_id = rg.person_id), 0) sold from rg) x
               group by x.k order by count(*) desc, min(x.k) limit 14) q),
  -- ---------------- 5) dia da semana e horário (America/Sao_Paulo; faixas de 4 horas)
  hr as materialized (select op.person_id, extract(dow from (op.created_at at time zone 'America/Sao_Paulo'))::int dow, (extract(hour from (op.created_at at time zone 'America/Sao_Paulo'))::int / 4) band from op),
  heat as (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'band', band, 'n', n) order by dow, band), '[]') j from (select dow, band, count(*) n from hr group by 1, 2) x),
  resp as (select coalesce(jsonb_agg(jsonb_build_object('band', band, 'n', n, 'median_min', md) order by band), '[]') j from (
              select hr.band, count(*) n, round((percentile_cont(0.5) within group (order by extract(epoch from (st.at - op.created_at)) / 60.0))::numeric, 0) md
                from st join op on op.person_id = st.person_id join hr on hr.person_id = st.person_id where st.kind = 'contacted' and st.at >= op.created_at group by hr.band) x),
  -- ---------------- 6) retorno por mês de captação
  ms as (select (date_trunc('month', g::timestamp))::date m from generate_series(v_first_month, p_to, '1 month') g),
  opm as materialized (select op.person_id, (date_trunc('month', private.mkt_day(op.created_at)::timestamp))::date m from op where private.mkt_day(op.created_at) >= v_first_month),
  pay as materialized (select opm.m, ((extract(year from private.mkt_day(e.ev_at)) * 12 + extract(month from private.mkt_day(e.ev_at))) - (extract(year from opm.m) * 12 + extract(month from opm.m)))::int off, e.cents
                         from ev e join opm on opm.person_id = e.person_id where e.kind = 'payment' and e.ev_at is not null),
  smo as (select (date_trunc('month', sd.day::timestamp))::date m, sum(sd.spend) s from public.mkt_spend_daily sd join sc on sc.campaign_id = sd.campaign_id
           where sd.resolution = 'active' and sd.currency = cur and sd.day between greatest(p_from, v_first_month) and p_to group by 1),
  mon as (select coalesce(jsonb_agg(jsonb_build_object('month', ms.m, 'leads', (select count(*) from opm where opm.m = ms.m), 'spend', (select s from smo where smo.m = ms.m),
              'sold', (select count(*) from st join opm on opm.person_id = st.person_id where st.kind = 'sold' and opm.m = ms.m),
              'cum', (select coalesce(jsonb_agg(round(coalesce((select sum(p.cents) from pay p where p.m = ms.m and p.off <= k), 0) / 100.0, 2) order by k), '[]')
                        from generate_series(0, least(12, ((extract(year from p_to) * 12 + extract(month from p_to)) - (extract(year from ms.m) * 12 + extract(month from ms.m)))::int)) k)) order by ms.m), '[]') j from ms)
  select jsonb_build_object(
    'currency', cur, 'period', jsonb_build_object('from', p_from, 'to', p_to), 'leads', (select count(*) from op),
    'timing', jsonb_build_object('overall', (select j from t_all), 'by_campaign', (select j from t_camp), 'curve', (select j from curve)),
    'totals', (select j from tot),
    'dropoff', jsonb_build_object('overall', (select j from d_all), 'by_campaign', (select j from d_camp), 'lost_reasons', (select j from lost), 'lost_total', (select n from lost_n)),
    'quality', (select j from qual), 'regions', (select j from reg),
    'hours', jsonb_build_object('heat', (select j from heat), 'first_response', (select j from resp)),
    'monthly', jsonb_build_object('rows', (select j from mon), 'first_month', v_first_month),
    'basis', 'Grupo de leads: pessoas captadas no período (uma por pessoa, na primeira oportunidade atribuída a campanha), acompanhadas até hoje. Tempo em dias corridos desde a captação; retorno = vendas confirmadas e recebimentos líquidos de estorno desse grupo.') into res;
  return res;
end $$;
revoke all on function public.mkt_analytics(date, date, jsonb) from public, anon;
grant execute on function public.mkt_analytics(date, date, jsonb) to authenticated;
