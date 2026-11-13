-- HP Group Hub — 123 Busca global de pessoas e leads (barra de pesquisa).
-- O administrador digita uma frase e a busca entende: o TIPO (fisioterapeuta, paciente, lead, aluno…), a LOCALIZAÇÃO (bairro, cidade, UF ou ZONA, como “zona sul”) e termos livres (nome, e-mail, telefone).
--   “fisioterapeuta copacabana”  · “fisioterapeuta zona sul rio de janeiro”  · “paciente moema”  · “lead campinas”  · “maria 9999”
-- Sem acento nem caixa. Todas as partes digitadas precisam combinar (E). Para fisioterapeuta, a zona vale tanto para onde mora quanto para as zonas que ele diz atender, e “cidades/regiões em que atende” entra na busca de cidade.
-- SECURITY INVOKER: roda com as permissões de quem pesquisa (RLS de pessoas, contatos e perfis) — a busca nunca mostra mais do que o usuário já poderia ver. Só leitura; nada é gravado.

create or replace function public.search_norm(p text) returns text language sql immutable set search_path = '' as $$
  select lower(translate(coalesce(p, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')) $$;
grant execute on function public.search_norm(text) to anon, authenticated;

create or replace function public.search_people(p_q text, p_limit int default 20) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  qn text := public.search_norm(btrim(coalesce(p_q, ''))); q0 text; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 40);
  v_physio boolean := false; v_patient boolean := false; v_student boolean := false; v_lead boolean := false; v_staff boolean := false; v_supplier boolean := false; v_contact boolean := false;
  zone_ids text[] := '{}'; zone_labels text[] := '{}'; kinds_lbl text[] := '{}'; terms text[]; z record; phrase text; res jsonb;
begin
  if length(qn) < 2 then return jsonb_build_object('filters', jsonb_build_object('kinds', '[]'::jsonb, 'zones', '[]'::jsonb, 'terms', '[]'::jsonb), 'items', '[]'::jsonb, 'total', 0); end if;
  q0 := qn;
  -- tipo
  if qn ~ '\m(fisioterapeutas?|fisios?|profissionais|profissional)\M' then v_physio := true; kinds_lbl := array_append(kinds_lbl, 'Fisioterapeutas e parceiros'); qn := regexp_replace(qn, '\m(fisioterapeutas?|fisios?|profissionais|profissional)\M', ' ', 'g'); end if;
  if qn ~ '\m(pacientes?)\M' then v_patient := true; kinds_lbl := array_append(kinds_lbl, 'Pacientes'); qn := regexp_replace(qn, '\m(pacientes?)\M', ' ', 'g'); end if;
  if qn ~ '\m(alunos?|alunas?|estudantes?)\M' then v_student := true; kinds_lbl := array_append(kinds_lbl, 'Alunos'); qn := regexp_replace(qn, '\m(alunos?|alunas?|estudantes?)\M', ' ', 'g'); end if;
  if qn ~ '\m(leads?)\M' then v_lead := true; kinds_lbl := array_append(kinds_lbl, 'Leads'); qn := regexp_replace(qn, '\m(leads?)\M', ' ', 'g'); end if;
  if qn ~ '\m(equipe|staff|funcionarios?)\M' then v_staff := true; kinds_lbl := array_append(kinds_lbl, 'Equipe'); qn := regexp_replace(qn, '\m(equipe|staff|funcionarios?)\M', ' ', 'g'); end if;
  if qn ~ '\m(fornecedor|fornecedores)\M' then v_supplier := true; kinds_lbl := array_append(kinds_lbl, 'Fornecedores'); qn := regexp_replace(qn, '\m(fornecedor|fornecedores)\M', ' ', 'g'); end if;
  if qn ~ '\m(contatos?)\M' then v_contact := true; kinds_lbl := array_append(kinds_lbl, 'Contatos'); qn := regexp_replace(qn, '\m(contatos?)\M', ' ', 'g'); end if;
  -- zona: “zona sul”, “zona norte”… (o Centro só como “zona centro”, porque “Centro” também é nome de bairro)
  for z in select zone_id, label from public.geo_zones order by position loop
    phrase := case when z.label = 'Centro' then 'zona centro' else public.search_norm(z.label) end;
    if q0 ~ ('\m' || phrase || '\M') then zone_ids := zone_ids || z.zone_id; if not (z.label = any (zone_labels)) then zone_labels := zone_labels || z.label; end if; end if;
  end loop;
  qn := regexp_replace(regexp_replace(qn, '\mzona (sul|norte|leste|oeste|centro)\M', ' ', 'g'), '\s+', ' ', 'g');
  terms := array(select t from regexp_split_to_table(btrim(qn), '\s+') t where t <> '' and t not in ('de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'e', 'a', 'o', 'com', 'que', 'tem', 'ha', 'existe', 'algum', 'alguma', 'zona', 'bairro', 'cidade'));
  if cardinality(terms) = 0 and cardinality(zone_ids) = 0 and cardinality(kinds_lbl) = 0 then
    return jsonb_build_object('filters', jsonb_build_object('kinds', '[]'::jsonb, 'zones', '[]'::jsonb, 'terms', '[]'::jsonb), 'items', '[]'::jsonb, 'total', 0);
  end if;

  with base as (
    select p.id, p.full_name, p.city, p.state_uf, p.neighborhood, p.zone, pp.service_zones, pp.service_regions, (pp.person_id is not null) has_profile,
           coalesce((select array_agg(distinct pk.kind::text order by pk.kind::text) from public.person_kinds pk where pk.person_id = p.id), '{}') kinds,
           (select c.value from public.person_contacts c where c.person_id = p.id and c.type in ('phone', 'whatsapp') order by c.is_primary desc, c.value limit 1) phone,
           (select c.value from public.person_contacts c where c.person_id = p.id and c.type = 'email' order by c.is_primary desc, c.value limit 1) email,
           public.search_norm(p.full_name) nn, public.search_norm(coalesce(p.city, '')) cn, public.search_norm(coalesce(p.neighborhood, '')) bn, public.search_norm(coalesce(pp.service_regions, '')) sn
      from public.people p left join public.professional_profiles pp on pp.person_id = p.id
     where p.merged_into_id is null and p.archived_at is null
  ), f as (
    select b.* from base b
     where (not v_physio or b.has_profile or 'partner' = any (b.kinds))
       and (not v_patient or 'patient' = any (b.kinds)) and (not v_student or 'student' = any (b.kinds)) and (not v_lead or 'lead' = any (b.kinds))
       and (not v_staff or 'staff' = any (b.kinds)) and (not v_supplier or 'supplier' = any (b.kinds)) and (not v_contact or 'contact' = any (b.kinds))
       and (cardinality(zone_ids) = 0 or b.zone = any (zone_ids) or coalesce(b.service_zones, '{}') && zone_ids)
       and not exists (select 1 from unnest(terms) t where not (
             b.nn like '%' || t || '%' or b.cn like '%' || t || '%' or b.bn like '%' || t || '%' or upper(coalesce(b.state_uf, '')) = upper(t) or b.sn like '%' || t || '%'
             or exists (select 1 from public.person_contacts c where c.person_id = b.id and (public.search_norm(c.value) like '%' || t || '%' or (t ~ '^[0-9]{4,}$' and c.normalized like '%' || t || '%')))))
  )
  select jsonb_build_object(
    'filters', jsonb_build_object('kinds', to_jsonb(kinds_lbl), 'zones', to_jsonb(zone_labels), 'terms', to_jsonb(terms)),
    'total', (select count(*) from f),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'city', x.city, 'state_uf', x.state_uf, 'neighborhood', x.neighborhood, 'zone', x.zone, 'service_zones', coalesce(x.service_zones, '{}'),
                          'kinds', x.kinds, 'is_physio', x.has_profile, 'phone', x.phone, 'email', x.email) order by x.rk, x.full_name)
                       from (select f.*, case when cardinality(terms) > 0 and f.nn like terms[1] || '%' then 0 else 1 end rk from f order by rk, f.full_name limit v_lim) x), '[]'::jsonb))
    into res;
  return res;
end $$;
revoke all on function public.search_people(text, int) from public, anon;
grant execute on function public.search_people(text, int) to authenticated;
