-- HP Group Hub — 147 Acesso ao portal: a pessoa precisa ser da organização de quem consulta/convida (Dev; white label).
-- Achado do teste de isolamento da jornada da Delta (N40-11): `portal_access_state` e `person_portal_access` autorizavam pelo PAPEL (gestor da organização ativa) mas não conferiam que a
-- pessoa-alvo é dessa organização — o gestor de uma organização lia o estado de acesso (e-mail mascarado, último envio, primeiro acesso) de paciente de OUTRA. Agora a pessoa é conferida.
-- Varredura: demais funções públicas que recebem id de pessoa usam require_care/has_unit_role/sched_can_manage (já validam a organização desde a migration 134); estas duas eram as únicas que usavam
-- has_org_role sem olhar o alvo.

CREATE OR REPLACE FUNCTION public.portal_access_state(p_person uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid := private.current_org(); v_email text; v_linked boolean; v_open record; v_last record; v_first timestamptz;
begin
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'sem permissão' using errcode = '42501'; end if;   -- a pessoa TEM de ser da organização de quem chama (papel de gestor numa organização não vale para pessoa de outra)
  if v_org is null or not (private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) or private.has_care_relationship(p_person)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  v_email := private.person_email(p_person);
  v_linked := exists (select 1 from public.user_accounts where person_id = p_person and status = 'active');
  select i.expires_at into v_open from public.invitations i where i.person_id = p_person and i.role = 'member' and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc limit 1;
  select outcome, requested_at, error_code into v_last from public.portal_invites where person_id = p_person order by requested_at desc limit 1;
  select max(i.accepted_at) into v_first from public.invitations i where i.person_id = p_person and i.role = 'member' and i.accepted_at is not null;
  return jsonb_build_object('has_email', v_email is not null, 'email_masked', case when v_email is not null then private.mask_email(v_email) end,
    'account', case when v_linked then 'linked' when v_open.expires_at is not null then 'invite_open' else 'none' end, 'invite_expires_at', v_open.expires_at,
    'last_send', case when v_last.requested_at is not null then jsonb_build_object('at', v_last.requested_at, 'outcome', v_last.outcome, 'error_code', v_last.error_code) end,
    'first_access_at', v_first, 'delivery_tracked', false);
end $function$;
revoke all on function public.portal_access_state(uuid) from public, anon;
grant execute on function public.portal_access_state(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.person_portal_access(p_person uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid := private.current_org(); v_staff boolean := private.has_org_role(array['manager', 'ops_admin']::public.app_role[]);
begin
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'sem permissão' using errcode = '42501'; end if;   -- a pessoa TEM de ser da organização de quem chama (papel de gestor numa organização não vale para pessoa de outra)
  if v_org is null or not (v_staff or private.has_care_relationship(p_person)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- quem não é da gestão (fisioterapeuta com vínculo) só convida um e-mail JÁ cadastrado da pessoa: nunca um endereço digitado na hora
  if not v_staff and not exists (select 1 from public.person_contacts c where c.person_id = p_person and c.type = 'email' and lower(btrim(c.value)) = lower(btrim(coalesce(p_email, '')))) then
    raise exception 'use um e-mail já cadastrado desta pessoa';
  end if;
  return private.person_portal_access_core(v_org, p_person, p_email, (select auth.uid()));
end $function$;
revoke all on function public.person_portal_access(uuid, text) from public, anon;
grant execute on function public.person_portal_access(uuid, text) to authenticated;
