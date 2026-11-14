-- HP Group Hub — 125 Captação de leads: filtros do lead de PARCEIRO por experiência profissional e por área de atuação.
-- Hoje a lista e o mapa filtram por segmento, status, revisão, busca e estado. O formulário de parceria já pergunta (e o servidor já valida) duas coisas que viram filtro:
--   · experiência profissional = pergunta “Qual é seu momento profissional?”  → estudante | formado_iniciando | em_atuacao | gestor_proprietario
--   · área específica          = pergunta “Qual é sua principal área de atuação ou interesse?” → ortopedia | esportiva | neurologica | geriatrica | outra
-- Só valem para a jornada de parceria (parceiro e HP Academy): quem respondeu o formulário de paciente nunca tem essas respostas, então some de qualquer lista filtrada por elas.
-- As duas funções abaixo são NOVAS (v2); search_quiz_leads e quiz_lead_geo da migration 087 ficam como estavam (nada é removido). A lista v2 também devolve o texto das duas respostas.

create or replace function public.search_quiz_leads_v2(
  p_segment text default null, p_status text default null, p_needs_review boolean default null,
  p_search text default null, p_uf text default null, p_limit int default 50, p_offset int default 0,
  p_experience text default null, p_area text default null
) returns table (
  id uuid, journey text, status text, full_name text, email text, phone text, city text, state_uf text,
  origin_path text, page_slug text, started_at timestamptz, completed_at timestamptz, last_activity_at timestamptz,
  owner_user_id uuid, stage_name text, next_contact_at timestamptz, needs_review boolean, wants_academy boolean,
  whatsapp_clicked_at timestamptz, person_id uuid, opportunity_id uuid, has_health_answers boolean, academy_interest boolean, total_count bigint,
  experience_label text, area_label text
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select l.* from public.quiz_leads l
     where private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id)
       and private.quiz_lead_in_segment(l.journey, l.answers, p_segment)
       and (p_status is null or l.status = p_status)
       and (p_needs_review is null or l.needs_review = p_needs_review)
       and (p_uf is null or btrim(p_uf) = '' or l.state_uf = upper(btrim(p_uf)))
       and (p_search is null or btrim(p_search) = '' or l.full_name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
       and (p_experience is null or btrim(p_experience) = '' or (l.journey = 'parceria' and l.answers -> 'momento_profissional' ->> 'value' = btrim(p_experience)))
       and (p_area is null or btrim(p_area) = '' or (l.journey = 'parceria' and l.answers -> 'area_atuacao' ->> 'value' = btrim(p_area)))
  )
  select b.id, b.journey, b.status, b.full_name, b.email, b.phone, b.city, b.state_uf,
         b.origin_path, b.page_slug, b.started_at, b.completed_at, b.last_activity_at,
         b.owner_user_id, ps.name, o.next_contact_at, b.needs_review, b.wants_academy,
         b.whatsapp_clicked_at, b.person_id, b.opportunity_id,
         (b.answers ?| array['dor_intensidade','motivacao_melhora','impacto_qualidade_vida']),
         private.quiz_lead_in_segment(b.journey, b.answers, 'academy'),
         count(*) over (),
         case when b.journey = 'parceria' then b.answers -> 'momento_profissional' ->> 'label' end,
         case when b.journey = 'parceria' then b.answers -> 'area_atuacao' ->> 'label' || coalesce(' — ' || nullif(btrim(b.answers -> 'area_atuacao' ->> 'detalhe'), ''), '') end
  from base b
  left join public.opportunities o on o.id = b.opportunity_id
  left join public.pipeline_stages ps on ps.id = o.stage_id
  order by b.started_at desc
  limit least(coalesce(p_limit, 50), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke all on function public.search_quiz_leads_v2(text, text, boolean, text, text, int, int, text, text) from public, anon;
grant execute on function public.search_quiz_leads_v2(text, text, boolean, text, text, int, int, text, text) to authenticated;

create or replace function public.quiz_lead_geo_v2(
  p_segment text default null, p_status text default null, p_needs_review boolean default null, p_search text default null,
  p_experience text default null, p_area text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with base as (
    select l.state_uf, l.city from public.quiz_leads l
     where private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id)
       and private.quiz_lead_in_segment(l.journey, l.answers, p_segment)
       and (p_status is null or l.status = p_status)
       and (p_needs_review is null or l.needs_review = p_needs_review)
       and (p_search is null or btrim(p_search) = '' or l.full_name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
       and (p_experience is null or btrim(p_experience) = '' or (l.journey = 'parceria' and l.answers -> 'momento_profissional' ->> 'value' = btrim(p_experience)))
       and (p_area is null or btrim(p_area) = '' or (l.journey = 'parceria' and l.answers -> 'area_atuacao' ->> 'value' = btrim(p_area)))
  ), tot as (
    select count(*) total, count(*) filter (where state_uf is null) sem from base
  ), st as (
    select state_uf, count(*) n from base where state_uf is not null group by state_uf
  ), ct as (
    select initcap(btrim(city)) city, state_uf, count(*) n from base where state_uf is not null and nullif(btrim(city), '') is not null group by 1, 2
  )
  select jsonb_build_object(
    'total', (select total from tot), 'sem_localizacao', (select sem from tot),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('uf', state_uf, 'count', n, 'pct', round(n * 100.0 / nullif((select total - sem from tot), 0), 1)) order by n desc, state_uf), '[]'::jsonb) from st),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('city', city, 'uf', state_uf, 'count', n) order by n desc, city), '[]'::jsonb) from ct))
  into res;
  return res;
end $$;
revoke all on function public.quiz_lead_geo_v2(text, text, boolean, text, text, text) from public, anon;
grant execute on function public.quiz_lead_geo_v2(text, text, boolean, text, text, text) to authenticated;
