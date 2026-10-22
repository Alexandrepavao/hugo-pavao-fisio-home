-- (1) O local que a pessoa digita no quiz (cidade/UF) passa a preencher o cadastro dela (people), que alimenta Pessoas, Planilha administrativa e a Distribuição geográfica.
-- (2) person_form_answers: tudo o que a pessoa preencheu nos formulários (quizzes e formulários de página), para mostrar no cadastro, no card do CRM e na conversa.
-- (3) crm_geo_distribution: Distribuição geográfica dos contatos do CRM (pessoas com oportunidade), por tipo de lead.
-- Só acrescenta funções/gatilho; o preenchimento retroativo só completa cadastros SEM cidade e UF (nunca troca um dado já cadastrado).

-- ---------------------------------------------------------------- 1) cidade/UF do quiz → cadastro
create or replace function private.quiz_sync_person_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.person_id is not null and nullif(btrim(coalesce(new.city, '')), '') is not null and new.state_uf is not null then
    update public.people set city = btrim(new.city), state_uf = new.state_uf
     where id = new.person_id and nullif(btrim(coalesce(city, '')), '') is null and state_uf is null;
  end if;
  return null;
end $$;
revoke all on function private.quiz_sync_person_location() from public, anon, authenticated;
create trigger quiz_leads_sync_person_location after insert or update of city, state_uf on public.quiz_leads
  for each row execute function private.quiz_sync_person_location();

-- retroativo: quem já respondeu o quiz e ainda não tem local no cadastro recebe o do envio mais recente
update public.people p set city = l.city, state_uf = l.state_uf
  from (select distinct on (person_id) person_id, btrim(city) city, state_uf from public.quiz_leads
         where person_id is not null and nullif(btrim(coalesce(city, '')), '') is not null and state_uf is not null
         order by person_id, last_activity_at desc) l
 where p.id = l.person_id and nullif(btrim(coalesce(p.city, '')), '') is null and p.state_uf is null;

-- ---------------------------------------------------------------- 2) o que a pessoa preencheu nos formulários
-- Mesmas regras do detalhe da captação: papéis de gestão/comercial na unidade do envio; respostas de saúde só para gestão (nunca o papel comercial).
create or replace function public.person_form_answers(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_quiz jsonb; v_forms jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'journey', l.journey, 'status', l.status, 'city', l.city, 'state_uf', l.state_uf,
      'answers', case when private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], l.unit_id) then l.answers
                      else l.answers - 'dor_intensidade' - 'motivacao_melhora' - 'impacto_qualidade_vida' end,
      'health_answers_restricted', not private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], l.unit_id),
      'started_at', l.started_at, 'completed_at', l.completed_at, 'last_activity_at', l.last_activity_at,
      'origin_path', l.origin_path, 'page_slug', l.page_slug, 'marketing_consent', l.marketing_consent) order by l.started_at desc), '[]'::jsonb)
    into v_quiz
    from public.quiz_leads l
   where l.person_id = p_person and private.in_org(l.org_id)
     and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'form_name', f.name, 'page_slug', pg.slug, 'created_at', s.created_at,
      'fields', coalesce((select jsonb_agg(jsonb_build_object('label', fld ->> 'label', 'value', s.answers ->> (fld ->> 'key')))
                            from jsonb_array_elements(f.fields) fld where s.answers ? (fld ->> 'key')), '[]'::jsonb)) order by s.created_at desc), '[]'::jsonb)
    into v_forms
    from public.form_submissions s join public.forms f on f.id = s.form_id left join public.pages pg on pg.id = s.page_id
   where s.person_id = p_person and private.in_org(s.org_id)
     and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], f.unit_id);
  return jsonb_build_object('quiz', v_quiz, 'forms', v_forms);
end $$;
revoke all on function public.person_form_answers(uuid) from public, anon;
grant execute on function public.person_form_answers(uuid) to authenticated;

-- ---------------------------------------------------------------- 3) Distribuição geográfica do CRM
-- Contatos do CRM = pessoas com ao menos uma oportunidade (como a tela Contatos); em funil de empresas conta a EMPRESA (local do cadastro dela).
-- p_kind = tipo do funil (patients, partners, education, companies) ou nulo para todos. Cada contato conta uma vez.
create or replace function public.crm_geo_distribution(p_kind text default null, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; res jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := private.crm_units(p_unit);
  with c as (
    select distinct on (k) k, city, uf, country from (
      select case when pl.kind = 'companies' and op.legal_entity_id is not null then 'e:' || op.legal_entity_id::text else 'p:' || op.person_id::text end k,
             nullif(btrim(coalesce(case when pl.kind = 'companies' and op.legal_entity_id is not null then le.city else pe.city end, '')), '') city,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then le.state_uf else pe.state_uf end uf,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then le.country else coalesce(pe.country, 'BR') end country
        from public.opportunities op
        join public.pipelines pl on pl.id = op.pipeline_id
        left join public.people pe on pe.id = op.person_id
        left join public.legal_entities le on le.id = op.legal_entity_id
       where op.org_id = private.current_org() and op.unit_id = any (u) and (p_kind is null or pl.kind = p_kind)
         and (pe.id is null or (pe.archived_at is null and pe.merged_into_id is null))) x
    order by k
  ), st as (select uf, count(*) n from c where uf is not null and coalesce(country, 'BR') = 'BR' group by uf),
     ct as (select city, uf, count(*) n from c where city is not null and uf is not null and coalesce(country, 'BR') = 'BR' group by 1, 2 order by 3 desc, 1 limit 20),
     co as (select country, count(*) n from c where coalesce(country, 'BR') <> 'BR' group by 1)
  select jsonb_build_object(
    'total', (select count(*) from c),
    'sem_localizacao', (select count(*) from c where uf is null and city is null and coalesce(country, 'BR') = 'BR'),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'count', n, 'pct', round(n * 100.0 / nullif((select count(*) from c), 0), 1)) order by n desc, uf), '[]'::jsonb) from st),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('city', city, 'uf', uf, 'count', n) order by n desc, city), '[]'::jsonb) from ct),
    'by_country_other', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'count', n) order by n desc), '[]'::jsonb) from co))
  into res;
  return res;
end $$;
revoke all on function public.crm_geo_distribution(text, uuid) from public, anon;
grant execute on function public.crm_geo_distribution(text, uuid) to authenticated;
