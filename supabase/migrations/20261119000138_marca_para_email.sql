-- HP Group Hub — 138 Marca da organização para os e-mails de autenticação (hook do Auth → Resend).
-- O hook (service_role) descobre a organização do destinatário só para identificar a marca no e-mail: convite aberto → e-mail de gestor inicial → vínculo padrão.
-- Organização HP (ou sem organização encontrada) mantém o e-mail HP atual. Devolve APENAS dados públicos de marca (nunca ids de pessoas, papéis ou dados clínicos).
create or replace function public.email_brand_for_address(p_email text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_org uuid;
begin
  if v_email = '' then return jsonb_build_object('found', false); end if;
  select i.org_id into v_org from public.invitations i where lower(i.email::text) = v_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc limit 1;
  if v_org is null then select b.org_id into v_org from private.manager_bootstrap_emails b where lower(b.email::text) = v_email and b.consumed_at is null limit 1; end if;
  if v_org is null then select m.org_id into v_org from public.org_memberships m join auth.users u on u.id = m.user_id where lower(u.email) = v_email and m.status = 'active' order by m.is_default desc, m.created_at limit 1; end if;
  if v_org is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true) || (private.org_brand_json(v_org) - 'org_id' - 'support_phone' - 'support_email' - 'texts' - 'version');
end $$;
revoke all on function public.email_brand_for_address(text) from public, anon, authenticated; grant execute on function public.email_brand_for_address(text) to service_role;
