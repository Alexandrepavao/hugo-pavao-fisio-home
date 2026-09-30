-- HP Group Hub — 056 Indicadores ampliados: Administrativo, CRM (tempo/conversão/ciclo/perdas/desempenho) e Captação (quizzes e formulários).
-- Regras: dados reais; cada indicador traz a própria fórmula/denominador em `basis`; escopo de unidade e permissão iguais aos das telas atuais
-- (adm: private.can_adm; CRM: private.crm_units/crm_effective_owner; captação: papéis de captação + crm_units). Nada é inventado retroativamente:
-- tempo por etapa usa opportunity_events (existente desde a criação do CRM); oportunidades sem evento de criação têm a 1ª etapa sem duração.
-- Todas as RPCs de detalhe devolvem o MESMO formato de crm_card_detail/dashboard_card_detail (kind, label, value, basis, items, total_items, list_route).

-- ---------------------------------------------------------------- formato comum dos detalhes clicáveis
create or replace function private.ind_detail(p_kind text, p_label text, p_value numeric, p_basis text, p_snapshot boolean,
  p_from timestamptz, p_to timestamptz, p_items jsonb, p_total bigint, p_route text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('kind', p_kind, 'label', p_label, 'value', p_value, 'available', true, 'basis', p_basis, 'is_current_snapshot', p_snapshot,
    'period', jsonb_build_object('from', p_from, 'to', p_to), 'items', coalesce(p_items, '[]'::jsonb), 'total_items', p_total, 'list_route', p_route)
$$;

-- ================================================================ ADMINISTRATIVO
create or replace function private.adm_scope_units(p_unit uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); u uuid[];
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
    select array_agg(id) into u from public.units where org_id = v_org and (p_unit is null or id = p_unit);
  else
    select array_agg(distinct ra.unit_id) into u from public.role_assignments ra
     where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','sales']::public.app_role[]) and ra.unit_id is not null and ra.revoked_at is null
       and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit);
  end if;
  return coalesce(u, '{}'::uuid[]);
end $$;

-- Painel do Administrativo. Universo: cadastros ATIVOS no sentido de não arquivados e não mesclados (PF = people; PJ = legal_entities).
-- "Ativo/Pendente/Inativo" é o status cadastral (registration_status), não uma medida de atividade comercial.
create or replace function public.adm_dashboard(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); u uuid[] := private.adm_scope_units(p_unit);
  v_all boolean := (p_unit is null and private.has_org_role(array['manager','ops_admin']::public.app_role[])); res jsonb;
begin
  with pf as (
    select p.id, p.full_name, p.unit_id, p.created_at, p.registration_status st, p.document_number, p.city, p.state_uf,
           exists (select 1 from public.person_contacts c where c.person_id = p.id) has_contact
      from public.people p
     where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
       and (v_all or p.unit_id = any (u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any (u)))),
  pj as (
    select e.id, e.legal_name, e.created_at, e.registration_status st, e.cnpj, e.city, e.state_uf, (e.email_general is not null or e.phone is not null) has_contact
      from public.legal_entities e
     where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
       and (v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any (u))))
  select jsonb_build_object(
    'total', private.metric((select count(*) from pf) + (select count(*) from pj), true, 'cadastros ativos no sentido de não arquivados/mesclados: pessoas físicas + jurídicas na unidade/organização'),
    'pf', private.metric((select count(*) from pf), true, 'pessoas físicas cadastradas (não arquivadas, não mescladas)'),
    'pj', private.metric((select count(*) from pj), true, 'pessoas jurídicas cadastradas (não arquivadas, não mescladas)'),
    'new', private.metric((select count(*) from pf where created_at >= p_from and created_at < p_to) + (select count(*) from pj where created_at >= p_from and created_at < p_to), true,
      'cadastros (PF + PJ) criados no período selecionado'),
    'new_pf', (select count(*) from pf where created_at >= p_from and created_at < p_to),
    'new_pj', (select count(*) from pj where created_at >= p_from and created_at < p_to),
    'status', jsonb_build_array(
      jsonb_build_object('status', 'ativo',    'label', 'Ativos',    'pf', (select count(*) from pf where st = 'ativo'),    'pj', (select count(*) from pj where st = 'ativo')),
      jsonb_build_object('status', 'pendente', 'label', 'Pendentes', 'pf', (select count(*) from pf where st = 'pendente'), 'pj', (select count(*) from pj where st = 'pendente')),
      jsonb_build_object('status', 'inativo',  'label', 'Inativos',  'pf', (select count(*) from pf where st = 'inativo'),  'pj', (select count(*) from pj where st = 'inativo'))),
    'incomplete', private.metric(
      (select count(*) from pf where not (document_number is not null and city is not null and state_uf is not null and has_contact))
      + (select count(*) from pj where not (cnpj is not null and city is not null and state_uf is not null and has_contact)), true,
      'cadastros sem algum dado mínimo: PF = documento, cidade, UF e um contato; PJ = CNPJ, cidade, UF e e-mail geral ou telefone'),
    'missing', jsonb_build_array(
      jsonb_build_object('field', 'documento', 'label', 'Documento (CPF/CNPJ)', 'pf', (select count(*) from pf where document_number is null), 'pj', (select count(*) from pj where cnpj is null)),
      jsonb_build_object('field', 'cidade',    'label', 'Cidade',               'pf', (select count(*) from pf where city is null),            'pj', (select count(*) from pj where city is null)),
      jsonb_build_object('field', 'uf',        'label', 'UF',                   'pf', (select count(*) from pf where state_uf is null),        'pj', (select count(*) from pj where state_uf is null)),
      jsonb_build_object('field', 'contato',   'label', 'Contato',              'pf', (select count(*) from pf where not has_contact),         'pj', (select count(*) from pj where not has_contact))),
    'by_kind', (select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'n', n) order by n desc), '[]'::jsonb)
                  from (select pk.kind::text k, count(*) n from public.person_kinds pk join pf on pf.id = pk.person_id group by pk.kind) x),
    'by_unit', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', un.id, 'unit', un.name,
                  'pf', (select count(*) from pf where pf.unit_id = un.id),
                  'pj', (select count(*) from pj where exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = pj.id and leu.unit_id = un.id))) order by un.name), '[]'::jsonb)
                  from public.units un where un.org_id = v_org and un.id = any (u))
  ) into res;
  return res;
end $$;

-- Detalhe clicável do painel do Administrativo: a lista de registros por trás de cada cartão.
create or replace function public.adm_indicator_detail(p_kind text, p_value text default null, p_from timestamptz default null, p_to timestamptz default null, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); u uuid[] := private.adm_scope_units(p_unit);
  v_all boolean := (p_unit is null and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
  v_label text; v_route text := '/admin/adm/diretorio'; v_items jsonb; v_total bigint;
begin
  if p_kind not in ('total','pf','pj','new','status','incomplete','missing','kind','unit') then raise exception 'indicador desconhecido'; end if;
  v_label := case p_kind when 'total' then 'Total de cadastros' when 'pf' then 'Pessoas físicas' when 'pj' then 'Pessoas jurídicas'
    when 'new' then 'Novos cadastros no período' when 'status' then 'Cadastros com status ' || coalesce(p_value, '') when 'incomplete' then 'Cadastros incompletos'
    when 'missing' then 'Cadastros sem ' || coalesce(p_value, 'campo') when 'kind' then 'Pessoas com vínculo ' || coalesce(p_value, '') else 'Cadastros da unidade' end;
  v_route := case p_kind when 'pf' then '/admin/adm/diretorio?tipo=pf' when 'pj' then '/admin/adm/diretorio?tipo=pj' when 'incomplete' then '/admin/adm/diretorio?incompleto=1'
    when 'status' then '/admin/adm/diretorio?status=' || coalesce(p_value, '') when 'missing' then '/admin/adm/diretorio?incompleto=1'
    when 'kind' then '/admin/adm/diretorio?vinculo=' || coalesce(p_value, '') when 'unit' then '/admin/adm/diretorio?unidade=' || coalesce(p_value, '') else '/admin/adm/diretorio' end;
  with pf as (
    select p.id, p.full_name nome, p.unit_id, p.created_at, p.registration_status st, p.document_number, p.city, p.state_uf,
           exists (select 1 from public.person_contacts c where c.person_id = p.id) has_contact
      from public.people p
     where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
       and (v_all or p.unit_id = any (u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any (u)))),
  pj as (
    select e.id, e.legal_name nome, e.created_at, e.registration_status st, e.cnpj, e.city, e.state_uf, (e.email_general is not null or e.phone is not null) has_contact
      from public.legal_entities e
     where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
       and (v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any (u)))),
  allr as (
    select pf.id, 'PF'::text tipo, pf.nome, pf.created_at, pf.st, pf.unit_id,
           array_remove(array[case when pf.document_number is null then 'documento' end, case when pf.city is null then 'cidade' end,
                              case when pf.state_uf is null then 'uf' end, case when not pf.has_contact then 'contato' end], null) miss
      from pf
    union all
    select pj.id, 'PJ', pj.nome, pj.created_at, pj.st, null::uuid,
           array_remove(array[case when pj.cnpj is null then 'documento' end, case when pj.city is null then 'cidade' end,
                              case when pj.state_uf is null then 'uf' end, case when not pj.has_contact then 'contato' end], null)
      from pj),
  sel as (
    select a.* from allr a where case p_kind
      when 'total' then true when 'pf' then a.tipo = 'PF' when 'pj' then a.tipo = 'PJ'
      when 'new' then a.created_at >= p_from and a.created_at < p_to
      when 'status' then a.st = p_value
      when 'incomplete' then cardinality(a.miss) > 0
      when 'missing' then p_value = any (a.miss)
      when 'kind' then a.tipo = 'PF' and exists (select 1 from public.person_kinds pk where pk.person_id = a.id and pk.kind::text = p_value)
      when 'unit' then (a.tipo = 'PF' and a.unit_id = p_value::uuid)
                    or (a.tipo = 'PJ' and exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = a.id and leu.unit_id = p_value::uuid))
      else false end)
  select (select count(*) from sel),
         (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.nome,
              'subtitle', s.tipo || ' · ' || coalesce((select un.name from public.units un where un.id = s.unit_id), 'sem unidade principal')
                          || case when cardinality(s.miss) > 0 then ' · faltando: ' || array_to_string(s.miss, ', ') else '' end,
              'date', s.created_at, 'tag', s.st) order by s.created_at desc), '[]'::jsonb)
            from (select * from sel order by created_at desc limit 50) s)
    into v_total, v_items;
  return private.ind_detail('adm_' || p_kind, v_label, v_total, 'lista dos cadastros que compõem o indicador (mais recentes primeiro; o total pode exceder os 50 exibidos)', p_kind in ('total','pf','pj','status','incomplete','missing','kind','unit'),
    p_from, p_to, v_items, v_total, v_route);
end $$;

-- ================================================================ CRM
-- Base única de oportunidades do funil, no escopo do usuário (mesmas regras do dashboard do CRM). entered_at = quando entrou na etapa ATUAL
-- (último evento de entrada nessa etapa; sem evento, a criação da oportunidade).
create or replace function private.crm_opp_base(p_pipe uuid, p_units uuid[], p_owner uuid)
returns table (id uuid, person_id uuid, title text, stage_id uuid, stage_name text, stage_kind text, pos int, status text, owner_user_id uuid, source text,
               value_cents bigint, created_at timestamptz, closed_at timestamptz, last_contact_at timestamptz, lost_reason_id uuid, entered_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.person_id, o.title, o.stage_id, st.name, st.kind, st.position, o.status, o.owner_user_id, o.source, o.value_cents, o.created_at, o.closed_at,
         o.last_contact_at, o.lost_reason_id,
         coalesce((select max(e.created_at) from public.opportunity_events e
                    where e.opportunity_id = o.id and e.kind in ('created','stage_changed') and e.to_stage_id = o.stage_id), o.created_at)
    from public.opportunities o join public.pipeline_stages st on st.id = o.stage_id
   where o.org_id = private.current_org() and o.pipeline_id = p_pipe and o.unit_id = any (p_units) and (p_owner is null or o.owner_user_id = p_owner)
$$;

create or replace function public.crm_analytics(p_from timestamptz, p_to timestamptz, p_unit uuid default null, p_owner uuid default null,
  p_pipeline uuid default null, p_stalled_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.crm_units(p_unit); v_owner uuid := private.crm_effective_owner(p_owner); v_org uuid := private.current_org();
  v_pipe uuid := p_pipeline; v_days int := greatest(coalesce(p_stalled_days, 7), 1); res jsonb;
begin
  if v_pipe is null then
    select id into v_pipe from public.pipelines where org_id = v_org and active order by (kind = 'patients') desc, created_at limit 1;
  end if;
  if v_pipe is null or not exists (select 1 from public.pipelines where id = v_pipe and org_id = v_org) then raise exception 'funil inválido'; end if;

  with opp as (select * from private.crm_opp_base(v_pipe, u, v_owner)),
  stages as (select st.id, st.name, st.position, st.kind from public.pipeline_stages st where st.pipeline_id = v_pipe),
  open_now as (
    select o.*, extract(epoch from (now() - o.entered_at)) / 86400.0 days_in_stage,
           extract(epoch from (now() - greatest(o.entered_at, coalesce(o.last_contact_at, o.created_at)))) / 86400.0 days_idle
      from opp o where o.status = 'open'),
  stage_now as (
    select s.id, s.name, s.position, s.kind, count(o.id) n,
           round(avg(o.days_in_stage)::numeric, 1) avg_d,
           round((percentile_cont(0.5) within group (order by o.days_in_stage::double precision))::numeric, 1) med_d,
           round(max(o.days_in_stage)::numeric, 1) max_d
      from stages s left join open_now o on o.stage_id = s.id group by s.id, s.name, s.position, s.kind),
  passages as (
    select e.opportunity_id, e.to_stage_id stage_id, e.created_at entered,
           lead(e.created_at) over (partition by e.opportunity_id order by e.created_at, e.id) left_at
      from public.opportunity_events e
     where e.kind in ('created','stage_changed') and e.opportunity_id in (select id from opp)),
  hist as (
    select s.id, s.name, s.position, count(p.left_at) n,
           round(avg(extract(epoch from (p.left_at - p.entered)) / 86400.0)::numeric, 1) avg_d,
           round((percentile_cont(0.5) within group (order by (extract(epoch from (p.left_at - p.entered)) / 86400.0)::double precision))::numeric, 1) med_d
      from stages s left join passages p on p.stage_id = s.id and p.left_at is not null and p.left_at >= p_from and p.left_at < p_to
     group by s.id, s.name, s.position),
  max_open as (select max(position) mp from stages where kind = 'open'),
  cohort as (
    select o.id, o.status,
           case when o.status = 'won' then (select mp from max_open)
                else greatest(case when o.stage_kind = 'open' then o.pos else 0 end,
                              coalesce((select max(st2.position) from public.opportunity_events e join public.pipeline_stages st2 on st2.id = e.to_stage_id
                                         where e.opportunity_id = o.id and st2.kind = 'open'), 0)) end maxpos
      from opp o where o.created_at >= p_from and o.created_at < p_to),
  chain as (select s.id, s.name, s.position, (select count(*) from cohort c where c.maxpos >= s.position) reached from stages s where s.kind = 'open'),
  chain2 as (select c.*, lag(c.reached) over (order by c.position) prev, first_value(c.reached) over (order by c.position) first_r from chain c),
  closed_p as (select * from opp where status in ('won','lost') and closed_at >= p_from and closed_at < p_to),
  won_p as (select o.*, extract(epoch from (o.closed_at - o.created_at)) / 86400.0 cycle_d from closed_p o where o.status = 'won')
  select jsonb_build_object(
    'pipeline_id', v_pipe, 'stalled_days', v_days,
    'open_total', private.metric((select count(*) from open_now), true, 'oportunidades em aberto agora (foto de hoje) no funil e escopo selecionados'),
    'stalled', private.metric((select count(*) from open_now where days_idle > v_days), true,
      format('oportunidades em aberto sem troca de etapa nem contato registrado há mais de %s dias (foto de hoje)', v_days)),
    'stage_now', (select coalesce(jsonb_agg(jsonb_build_object('stage_id', id, 'name', name, 'position', position, 'kind', kind, 'n', n, 'avg_days', avg_d, 'median_days', med_d, 'max_days', max_d) order by position), '[]'::jsonb) from stage_now),
    'stage_history', (select coalesce(jsonb_agg(jsonb_build_object('stage_id', id, 'name', name, 'position', position, 'n', n, 'avg_days', avg_d, 'median_days', med_d) order by position), '[]'::jsonb) from hist),
    'cohort', private.metric((select count(*) from cohort), true, 'oportunidades CRIADAS no período (coorte, denominador das conversões abaixo)'),
    'chain', (select coalesce(jsonb_agg(jsonb_build_object('stage_id', id, 'name', name, 'position', position, 'reached', reached,
                'conv_prev_pct', case when prev > 0 then round(100.0 * reached / prev, 1) end,
                'conv_first_pct', case when first_r > 0 then round(100.0 * reached / first_r, 1) end) order by position), '[]'::jsonb) from chain2),
    'won_step', jsonb_build_object('won', (select count(*) from cohort where status = 'won'),
                'conv_prev_pct', (select case when c.reached > 0 then round(100.0 * (select count(*) from cohort where status = 'won') / c.reached, 1) end from (select reached from chain2 order by position desc limit 1) c)),
    'overall_conversion', private.metric((select round(100.0 * count(*) filter (where status = 'won') / nullif(count(*), 0), 1) from cohort), (select count(*) > 0 from cohort),
      'ganhas ÷ criadas no período (mesma coorte; as ainda abertas contam no denominador)'),
    'win_rate_closed', private.metric((select round(100.0 * count(*) filter (where status = 'won') / nullif(count(*), 0), 1) from closed_p), (select count(*) > 0 from closed_p),
      'ganhas ÷ (ganhas + perdidas) fechadas no período'),
    'won_in_period', private.metric((select count(*) from closed_p where status = 'won'), true, 'oportunidades ganhas (fechadas) no período'),
    'lost_in_period', private.metric((select count(*) from closed_p where status = 'lost'), true, 'oportunidades perdidas (fechadas) no período'),
    'cycle_avg_days', private.metric((select round(avg(cycle_d)::numeric, 1) from won_p), (select count(*) > 0 from won_p), 'média de dias entre criação e ganho das oportunidades ganhas no período'),
    'cycle_median_days', private.metric((select round((percentile_cont(0.5) within group (order by cycle_d::double precision))::numeric, 1) from won_p), (select count(*) > 0 from won_p), 'mediana de dias entre criação e ganho das oportunidades ganhas no período'),
    'loss_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason_id', rid, 'name', nm, 'n', n, 'pct', round(100.0 * n / nullif(tot, 0), 1)) order by n desc), '[]'::jsonb)
                       from (select o.lost_reason_id rid, coalesce(lr.name, 'Sem motivo') nm, count(*) n, sum(count(*)) over () tot
                               from closed_p o left join public.loss_reasons lr on lr.id = o.lost_reason_id where o.status = 'lost' group by o.lost_reason_id, lr.name) x),
    'by_owner', (select coalesce(jsonb_agg(jsonb_build_object('owner_id', k, 'name', nm, 'created', cr, 'won', w, 'lost', l, 'open', op,
                     'conv_pct', case when w + l > 0 then round(100.0 * w / (w + l), 1) end, 'won_value_cents', wv) order by w desc, cr desc), '[]'::jsonb)
                   from (select o.owner_user_id k, coalesce(ua.display_name, ua.email::text, 'Sem responsável') nm,
                                count(*) filter (where o.created_at >= p_from and o.created_at < p_to) cr,
                                count(*) filter (where o.status = 'won' and o.closed_at >= p_from and o.closed_at < p_to) w,
                                count(*) filter (where o.status = 'lost' and o.closed_at >= p_from and o.closed_at < p_to) l,
                                count(*) filter (where o.status = 'open') op,
                                coalesce(sum(o.value_cents) filter (where o.status = 'won' and o.closed_at >= p_from and o.closed_at < p_to), 0) wv
                           from opp o left join public.user_accounts ua on ua.user_id = o.owner_user_id group by o.owner_user_id, ua.display_name, ua.email) t
                  where cr + w + l + op > 0),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', k, 'created', cr, 'won', w, 'lost', l, 'open', op,
                     'conv_pct', case when w + l > 0 then round(100.0 * w / (w + l), 1) end, 'won_value_cents', wv) order by w desc, cr desc), '[]'::jsonb)
                   from (select coalesce(nullif(btrim(o.source), ''), 'Sem origem') k,
                                count(*) filter (where o.created_at >= p_from and o.created_at < p_to) cr,
                                count(*) filter (where o.status = 'won' and o.closed_at >= p_from and o.closed_at < p_to) w,
                                count(*) filter (where o.status = 'lost' and o.closed_at >= p_from and o.closed_at < p_to) l,
                                count(*) filter (where o.status = 'open') op,
                                coalesce(sum(o.value_cents) filter (where o.status = 'won' and o.closed_at >= p_from and o.closed_at < p_to), 0) wv
                           from opp o group by 1) t
                  where cr + w + l + op > 0)
  ) into res;
  return res;
end $$;

-- Detalhe clicável do CRM. p_kind: created | won | lost | open | stalled. p_dim (opcional): owner | source | reason | stage; p_value = id/valor ('none' = vazio).
create or replace function public.crm_indicator_detail(p_kind text, p_dim text default null, p_value text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_unit uuid default null, p_owner uuid default null, p_pipeline uuid default null, p_stalled_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.crm_units(p_unit); v_owner uuid := private.crm_effective_owner(p_owner); v_org uuid := private.current_org();
  v_pipe uuid := p_pipeline; v_days int := greatest(coalesce(p_stalled_days, 7), 1); v_total bigint; v_items jsonb; v_label text;
begin
  if p_kind not in ('created','won','lost','open','stalled') then raise exception 'indicador desconhecido'; end if;
  if p_dim is not null and p_dim not in ('owner','source','reason','stage') then raise exception 'dimensão desconhecida'; end if;
  if v_pipe is null then select id into v_pipe from public.pipelines where org_id = v_org and active order by (kind = 'patients') desc, created_at limit 1; end if;
  if v_pipe is null or not exists (select 1 from public.pipelines where id = v_pipe and org_id = v_org) then raise exception 'funil inválido'; end if;
  v_label := case p_kind when 'created' then 'Oportunidades criadas no período' when 'won' then 'Oportunidades ganhas no período' when 'lost' then 'Oportunidades perdidas no período'
                         when 'open' then 'Oportunidades em aberto' else 'Oportunidades paradas' end
             || case when p_dim is not null then ' — recorte: ' || p_dim else '' end;
  with opp as (select * from private.crm_opp_base(v_pipe, u, v_owner)),
  base as (
    select o.*, extract(epoch from (now() - o.entered_at)) / 86400.0 days_in_stage,
           extract(epoch from (now() - greatest(o.entered_at, coalesce(o.last_contact_at, o.created_at)))) / 86400.0 days_idle from opp o),
  sel as (
    select b.* from base b
     where case p_kind
             when 'created' then b.created_at >= p_from and b.created_at < p_to
             when 'won' then b.status = 'won' and b.closed_at >= p_from and b.closed_at < p_to
             when 'lost' then b.status = 'lost' and b.closed_at >= p_from and b.closed_at < p_to
             when 'open' then b.status = 'open'
             else b.status = 'open' and b.days_idle > v_days end
       and case p_dim
             when 'owner' then (case when p_value = 'none' then b.owner_user_id is null else b.owner_user_id = p_value::uuid end)
             when 'source' then coalesce(nullif(btrim(b.source), ''), 'Sem origem') = p_value
             when 'reason' then (case when p_value = 'none' then b.lost_reason_id is null else b.lost_reason_id = p_value::uuid end)
             when 'stage' then b.stage_id = p_value::uuid
             else true end)
  select (select count(*) from sel),
         (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', coalesce(pe.full_name, '—') || ' — ' || s.title,
              'subtitle', s.stage_name || ' · ' || coalesce(ua.display_name, ua.email::text, 'sem responsável')
                          || case when s.status = 'open' then ' · ' || round(s.days_in_stage::numeric, 1)::text || ' dia(s) na etapa' else '' end,
              'amount_cents', s.value_cents, 'date', case when s.status = 'open' then s.created_at else s.closed_at end, 'tag', s.status)
              order by case when p_kind = 'stalled' then s.days_idle end desc nulls last, s.created_at desc), '[]'::jsonb)
            from (select * from sel order by created_at desc limit 50) s
            left join public.people pe on pe.id = s.person_id left join public.user_accounts ua on ua.user_id = s.owner_user_id)
    into v_total, v_items;
  return private.ind_detail('crm_' || p_kind, v_label, v_total,
    'oportunidades que compõem o indicador no funil, escopo e período selecionados (mais recentes primeiro; o total pode exceder os 50 exibidos)', p_kind in ('open','stalled'),
    p_from, p_to, v_items, v_total, '/admin/crm/oportunidades');
end $$;

-- ================================================================ CAPTAÇÃO (quizzes + formulários)
-- Linhas de captação no período e escopo: cada resposta de quiz (quiz_leads, por started_at) e cada envio de formulário (form_submissions).
create or replace function private.cap_rows(p_units uuid[], p_from timestamptz, p_to timestamptz)
returns table (source_key text, source_label text, family text, rec_id uuid, person_id uuid, opportunity_id uuid, captured_at timestamptz, unit_id uuid, status text,
               step_reached int, last_activity_at timestamptz, completed_at timestamptz, whatsapp_clicked_at timestamptz, src text, camp text, page_slug text, nm text)
language sql stable security definer set search_path = '' as $$
  select 'quiz:' || l.journey, case l.journey when 'atendimento' then 'Quiz de atendimento' else 'Quiz de parceria' end, 'quiz', l.id, l.person_id, l.opportunity_id,
         l.started_at, l.unit_id, l.status, l.step_reached, l.last_activity_at, l.completed_at, l.whatsapp_clicked_at,
         coalesce(nullif(l.utm ->> 'utm_source', ''), '(sem origem)'), coalesce(nullif(l.utm ->> 'utm_campaign', ''), '(sem campanha)'), l.page_slug, l.full_name
    from public.quiz_leads l
   where l.org_id = private.current_org() and l.unit_id = any (p_units) and l.started_at >= p_from and l.started_at < p_to
  union all
  select 'form:' || f.id::text, 'Formulário: ' || f.name, 'form', s.id, s.person_id, s.opportunity_id, s.created_at, f.unit_id, 'completed', null::int, s.created_at, s.created_at, null::timestamptz,
         coalesce(nullif(s.utm ->> 'utm_source', ''), '(sem origem)'), coalesce(nullif(s.utm ->> 'utm_campaign', ''), '(sem campanha)'),
         (select pg.slug from public.pages pg where pg.id = s.page_id), (select pe.full_name from public.people pe where pe.id = s.person_id)
    from public.form_submissions s join public.forms f on f.id = s.form_id
   where s.org_id = private.current_org() and f.unit_id = any (p_units) and s.created_at >= p_from and s.created_at < p_to
$$;

create or replace function public.capture_analytics(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; res jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := private.crm_units(p_unit);
  with cap as (select * from private.cap_rows(u, p_from, p_to)),
  srcs as (select source_key, source_label, family, count(*) resp, count(distinct person_id) ppl, count(distinct opportunity_id) opps from cap group by 1, 2, 3),
  quiz as (select * from cap where family = 'quiz'),
  ent as (select person_id, min(captured_at) first_at from cap where person_id is not null group by person_id),
  fun as (
    select e.person_id, e.first_at,
           exists (select 1 from cap c where c.person_id = e.person_id and c.opportunity_id is not null) has_opp,
           exists (select 1 from public.appointments ap where ap.person_id = e.person_id and ap.created_at >= e.first_at) sched,
           exists (select 1 from public.appointments ap where ap.person_id = e.person_id and ap.created_at >= e.first_at and ap.status = 'attended') att,
           exists (select 1 from public.sales s where s.person_id = e.person_id and s.status = 'confirmed' and s.sold_at >= e.first_at) sold
      from ent e),
  gran as (select case when (p_to - p_from) > interval '92 days' then 'week' else 'day' end g),
  series as (select date_trunc((select g from gran), (c.captured_at at time zone 'America/Sao_Paulo'))::date d, count(*) resp,
                    count(*) filter (where c.family = 'quiz' and c.status = 'completed') done from cap c group by 1)
  select jsonb_build_object(
    'granularity', (select g from gran),
    'responses', private.metric((select count(*) from cap), true, 'RESPOSTAS: cada quiz iniciado e cada formulário enviado no período (a mesma pessoa pode responder mais de uma vez)'),
    'people', private.metric((select count(distinct person_id) from cap), true, 'PESSOAS distintas identificadas nas respostas do período'),
    'opportunities', private.metric((select count(distinct opportunity_id) from cap), true, 'OPORTUNIDADES distintas geradas pelas respostas do período'),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source_key', source_key, 'label', source_label, 'family', family, 'responses', resp, 'people', ppl, 'opportunities', opps) order by resp desc), '[]'::jsonb) from srcs),
    'quiz', jsonb_build_object(
      'started', (select count(*) from quiz),
      'completed', (select count(*) from quiz where status = 'completed'),
      'abandoned', (select count(*) from quiz where status <> 'completed' and last_activity_at < now() - interval '24 hours'),
      'in_progress', (select count(*) from quiz where status <> 'completed' and last_activity_at >= now() - interval '24 hours'),
      'completion_rate_pct', (select round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*), 0), 1) from quiz),
      'abandon_rate_pct', (select round(100.0 * count(*) filter (where status <> 'completed' and last_activity_at < now() - interval '24 hours') / nullif(count(*), 0), 1) from quiz),
      'basis', 'conclusão = concluídos ÷ iniciados no período; abandono = não concluídos e sem atividade há mais de 24 h ÷ iniciados (calculado na leitura, nunca gravado)',
      'abandoned_by_step', (select coalesce(jsonb_agg(jsonb_build_object('step', step_reached, 'n', n) order by step_reached), '[]'::jsonb)
                              from (select step_reached, count(*) n from quiz where status <> 'completed' and last_activity_at < now() - interval '24 hours' group by step_reached) x),
      'by_journey', (select coalesce(jsonb_agg(jsonb_build_object('source_key', source_key, 'label', source_label, 'started', st, 'completed', dn, 'abandoned', ab)), '[]'::jsonb)
                       from (select source_key, source_label, count(*) st, count(*) filter (where status = 'completed') dn,
                                    count(*) filter (where status <> 'completed' and last_activity_at < now() - interval '24 hours') ab
                               from quiz group by source_key, source_label) q)
    ),
    'whatsapp_clicks', private.metric((select count(*) from quiz where whatsapp_clicked_at is not null), true, 'CLIQUES no botão de WhatsApp entre os quizzes iniciados no período — um clique NÃO é uma mensagem enviada nem um atendimento'),
    'by_origin', (select coalesce(jsonb_agg(jsonb_build_object('origin', k, 'responses', resp, 'people', ppl, 'opportunities', opps) order by resp desc), '[]'::jsonb)
                    from (select src k, count(*) resp, count(distinct person_id) ppl, count(distinct opportunity_id) opps from cap group by src) x),
    'by_campaign', (select coalesce(jsonb_agg(jsonb_build_object('campaign', k, 'responses', resp, 'people', ppl, 'opportunities', opps) order by resp desc), '[]'::jsonb)
                      from (select camp k, count(*) resp, count(distinct person_id) ppl, count(distinct opportunity_id) opps from cap group by camp) x),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'responses', resp, 'quiz_completed', done) order by d), '[]'::jsonb) from series),
    'funnel', jsonb_build_object(
      'basis', 'cada etapa = PESSOAS (contadas uma vez) que, depois da primeira captação no período, ganharam opportunity / atendimento criado / atendimento realizado / venda confirmada; % = etapa ÷ pessoas capturadas (as etapas não são sequenciais)',
      'captured', (select count(*) from fun),
      'opportunity', (select count(*) from fun where has_opp),
      'scheduled', (select count(*) from fun where sched),
      'attended', (select count(*) from fun where att),
      'sold', (select count(*) from fun where sold))
  ) into res;
  return res;
end $$;

-- Detalhe clicável da captação. p_kind: responses | completed | abandoned | in_progress | whatsapp | funnel. p_dim: source | origin | campaign (p_value) ou, em funnel, p_value = captured|opportunity|scheduled|attended|sold.
create or replace function public.capture_indicator_detail(p_kind text, p_dim text default null, p_value text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_total bigint; v_items jsonb; v_label text;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind not in ('responses','completed','abandoned','in_progress','whatsapp','funnel') then raise exception 'indicador desconhecido'; end if;
  if p_dim is not null and p_dim not in ('source','origin','campaign') then raise exception 'dimensão desconhecida'; end if;
  if p_kind = 'funnel' and p_value not in ('captured','opportunity','scheduled','attended','sold') then raise exception 'etapa desconhecida'; end if;
  u := private.crm_units(p_unit);
  v_label := case p_kind when 'responses' then 'Respostas de captação' when 'completed' then 'Quizzes concluídos' when 'abandoned' then 'Quizzes abandonados (sem atividade há mais de 24 h)'
    when 'in_progress' then 'Quizzes em andamento' when 'whatsapp' then 'Cliques no WhatsApp (não são mensagens enviadas)'
    else 'Pessoas na etapa: ' || p_value end;
  if p_kind = 'funnel' then
    with cap as (select * from private.cap_rows(u, p_from, p_to)),
    ent as (select c.person_id, min(c.captured_at) first_at from cap c where c.person_id is not null group by c.person_id),
    fun as (
      select e.person_id, e.first_at,
             exists (select 1 from cap c where c.person_id = e.person_id and c.opportunity_id is not null) has_opp,
             exists (select 1 from public.appointments ap where ap.person_id = e.person_id and ap.created_at >= e.first_at) sched,
             exists (select 1 from public.appointments ap where ap.person_id = e.person_id and ap.created_at >= e.first_at and ap.status = 'attended') att,
             exists (select 1 from public.sales s where s.person_id = e.person_id and s.status = 'confirmed' and s.sold_at >= e.first_at) sold
        from ent e),
    sel as (select f.* from fun f where case p_value when 'captured' then true when 'opportunity' then f.has_opp when 'scheduled' then f.sched when 'attended' then f.att else f.sold end)
    select (select count(*) from sel),
           (select coalesce(jsonb_agg(jsonb_build_object('id', x.person_id, 'title', coalesce(pe.full_name, '—'), 'subtitle', 'primeira captação no período', 'date', x.first_at) order by x.first_at desc), '[]'::jsonb)
              from (select * from sel order by first_at desc limit 50) x left join public.people pe on pe.id = x.person_id)
      into v_total, v_items;
  else
    with cap as (select * from private.cap_rows(u, p_from, p_to)),
    sel as (
      select c.* from cap c
       where case p_kind
               when 'responses' then true
               when 'completed' then c.family = 'quiz' and c.status = 'completed'
               when 'abandoned' then c.family = 'quiz' and c.status <> 'completed' and c.last_activity_at < now() - interval '24 hours'
               when 'in_progress' then c.family = 'quiz' and c.status <> 'completed' and c.last_activity_at >= now() - interval '24 hours'
               else c.whatsapp_clicked_at is not null end
         and case p_dim when 'source' then c.source_key = p_value when 'origin' then c.src = p_value when 'campaign' then c.camp = p_value else true end)
    select (select count(*) from sel),
           (select coalesce(jsonb_agg(jsonb_build_object('id', x.rec_id, 'title', coalesce(x.nm, 'Sem identificação'), 'subtitle', x.source_label || ' · ' || x.src,
                'date', x.captured_at, 'tag', case when x.family = 'quiz' then x.status else 'enviado' end) order by x.captured_at desc), '[]'::jsonb)
              from (select * from sel order by captured_at desc limit 50) x)
      into v_total, v_items;
  end if;
  return private.ind_detail('capture_' || p_kind, v_label, v_total, 'registros que compõem o indicador no período e escopo selecionados (mais recentes primeiro; o total pode exceder os 50 exibidos)', false,
    p_from, p_to, v_items, v_total, '/admin/captacao-leads');
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.adm_dashboard(timestamptz, timestamptz, uuid), public.adm_indicator_detail(text, text, timestamptz, timestamptz, uuid),
  public.crm_analytics(timestamptz, timestamptz, uuid, uuid, uuid, int), public.crm_indicator_detail(text, text, text, timestamptz, timestamptz, uuid, uuid, uuid, int),
  public.capture_analytics(timestamptz, timestamptz, uuid), public.capture_indicator_detail(text, text, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.adm_dashboard(timestamptz, timestamptz, uuid), public.adm_indicator_detail(text, text, timestamptz, timestamptz, uuid),
  public.crm_analytics(timestamptz, timestamptz, uuid, uuid, uuid, int), public.crm_indicator_detail(text, text, text, timestamptz, timestamptz, uuid, uuid, uuid, int),
  public.capture_analytics(timestamptz, timestamptz, uuid), public.capture_indicator_detail(text, text, text, timestamptz, timestamptz, uuid) to authenticated;
