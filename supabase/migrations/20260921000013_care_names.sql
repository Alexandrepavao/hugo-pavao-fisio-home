-- HP Group Hub — 013 Nomes para a tela de acompanhamento sem abrir a tabela people a fisioterapeutas

-- Fisioterapeuta: apenas nomes dos pacientes com vínculo assistencial ativo
create or replace function public.care_patient_names() returns table (person_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select r.person_id, p.full_name from public.care_relationships r join public.people p on p.id = r.person_id
  where r.professional_user_id = (select auth.uid()) and r.revoked_at is null and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now())
    and private.has_unit_role(array['physio']::public.app_role[], r.unit_id)
$$;

-- Gestor/administração: lista de vínculos (paciente e profissional), sem qualquer conteúdo clínico
create or replace function public.list_care_links() returns table (id uuid, patient_name text, professional_name text, unit_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, p.full_name, coalesce(ua.display_name, ua.email::text), u.name, r.created_at
  from public.care_relationships r join public.people p on p.id = r.person_id join public.units u on u.id = r.unit_id
  left join public.user_accounts ua on ua.user_id = r.professional_user_id
  where r.revoked_at is null and r.org_id = private.current_org() and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], r.unit_id)
  order by r.created_at desc
$$;

grant execute on function public.care_patient_names(), public.list_care_links() to authenticated;
