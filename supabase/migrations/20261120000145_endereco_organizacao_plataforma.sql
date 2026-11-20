-- HP Group Hub — 145 Endereço por organização na administração da plataforma (Dev; white label).
--  · /empresa/<slug> é rota fixa: `empresa` entra nos slugs reservados do banco (uma página do editor não pode ocupar esse endereço);
--  · provisioning_get passa a devolver o slug da organização (a tela da plataforma monta o endereço de acesso /empresa/<slug> sem depender de DNS).
create or replace function private.is_reserved_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(s) = any (array['admin','login','logout','academy','portal','api','redefinir-senha','primeiro-acesso',
    'confirmar','trabalhe-conosco','paciente','parceiro','pesquisas','auth','assets','static','favicon.png','robots.txt','sitemap.xml',
    'netlify','supabase','p','preview','hp','hub','sistema','plataforma','empresa'])
$$;

CREATE OR REPLACE FUNCTION public.provisioning_get(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.provisioning_requests;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'org_id', r.org_id, 'org_slug', (select o.slug from public.organizations o where o.id = r.org_id), 'attempts', r.attempts, 'last_error', r.last_error, 'created_at', r.created_at, 'submitted_at', r.submitted_at, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'internal_ms', (select coalesce(round(sum(extract(epoch from (finished_at - started_at)) * 1000)), 0) from public.provisioning_steps where request_id = p_id and finished_at is not null),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('step', s.step, 'status', s.status, 'attempts', s.attempts, 'error', s.error, 'ms', case when s.finished_at is not null then round(extract(epoch from (s.finished_at - s.started_at)) * 1000) end) order by s.position) from public.provisioning_steps s where s.request_id = p_id), '[]'),
    'pending', case when r.status in ('available', 'available_with_pending') then private.prov_pending(p_id) else r.pending end, 'admin_invite', r.admin_invite, 'answers_summary', jsonb_build_object('company', r.answers #>> '{company,name}', 'segment', r.answers #>> '{company,segment}', 'subdomain', r.answers #>> '{brand,subdomain}'));
end $function$;
revoke all on function public.provisioning_get(uuid) from public, anon;
grant execute on function public.provisioning_get(uuid) to authenticated;
