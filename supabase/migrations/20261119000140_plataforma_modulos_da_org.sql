-- HP Group Hub — 140 A plataforma enxerga o ESTADO de habilitação de módulos de cada organização (não os dados dela).
-- Somente administradores da plataforma; devolve apenas chave, habilitado e origem (modelo/manual).
create or replace function public.platform_org_modules(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('module_key', om.module_key, 'enabled', om.enabled, 'source', om.source) order by om.module_key) from public.org_modules om where om.org_id = p_org), '[]'::jsonb);
end $$;
revoke all on function public.platform_org_modules(uuid) from public, anon; grant execute on function public.platform_org_modules(uuid) to authenticated;
