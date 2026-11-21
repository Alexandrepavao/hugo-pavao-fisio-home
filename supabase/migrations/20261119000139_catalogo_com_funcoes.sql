-- HP Group Hub — 139 O catálogo da plataforma passa a devolver também as funções (papéis) de cada modelo: o questionário "Equipe" lista só funções válidas para o segmento.
-- Mudança só de leitura (mesma função, mais um campo); permissão inalterada (administradores da plataforma).
create or replace function public.platform_catalog() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'segments', (select coalesce(jsonb_agg(to_jsonb(s) order by s.sort), '[]') from public.platform_segments s),
    'modules', (select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('requires', coalesce((select jsonb_agg(d.requires) from public.platform_module_deps d where d.module_key = m.key), '[]')) order by m.sort), '[]') from public.platform_modules m),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('segment_key', t.segment_key, 'version', t.version, 'status', t.status, 'published_at', t.published_at, 'notes', t.notes, 'default_modules', t.definition -> 'default_modules', 'optional_modules', t.definition -> 'optional_modules',
        'vocabulary', t.definition -> 'vocabulary', 'checklist', t.definition -> 'checklist', 'roles', t.definition -> 'roles', 'settings', t.definition -> 'settings') order by t.segment_key, t.version desc), '[]') from public.platform_templates t),
    'plans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.key), '[]') from public.platform_plans p));
end $$;
