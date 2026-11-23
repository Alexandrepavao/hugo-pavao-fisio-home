-- HP Group Hub — 155 Condições da avaliação: a principal vem sempre primeiro (antes as "associadas" apareciam antes por ordem alfabética do papel).
create or replace function private.presentation_conditions_json(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'condition_key', c.condition_key, 'label', coalesce(pc.label, c.free_text), 'free_text', c.free_text, 'role', c.role, 'status', c.status,
      'subtype_key', c.subtype_key, 'subtype_label', (select s ->> 'label' from jsonb_array_elements(coalesce(pc.subtypes, '[]'::jsonb)) s where s ->> 'key' = c.subtype_key limit 1),
      'body_region', c.body_region, 'laterality', c.laterality, 'onset_text', c.onset_text, 'position', c.position) order by (c.role = 'principal') desc, c.position), '[]'::jsonb)
    from public.presentation_conditions c left join public.physio_conditions pc on pc.key = c.condition_key where c.presentation_id = p_id
$$;
