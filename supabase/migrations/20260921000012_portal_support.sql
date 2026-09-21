-- HP Group Hub — 012 Suporte aos portais: autor da comunidade, dados próprios do paciente e diretório da equipe

alter table public.community_posts add column author_name text;
update public.community_posts cp set author_name = split_part(p.full_name, ' ', 1) from public.people p where p.id = cp.author_person_id;

create or replace function public.community_post(p_course uuid, p_body text, p_parent uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_id uuid; c public.courses; v_name text;
begin
  select * into c from public.courses where id = p_course;
  if not found or v_person is null or not (private.has_course_access(p_course) or private.can_manage_courses()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_parent is not null and not exists (select 1 from public.community_posts where id = p_parent and course_id = p_course) then raise exception 'comentário inválido'; end if;
  perform private.rate_limit('post:' || v_person, interval '10 minutes', 20);
  select split_part(full_name, ' ', 1) into v_name from public.people where id = v_person;
  insert into public.community_posts (org_id, course_id, parent_id, author_person_id, author_name, body) values (c.org_id, p_course, p_parent, v_person, v_name, btrim(p_body)) returning id into v_id;
  return v_id;
end $$;

-- Agenda do próprio paciente (nomes de serviço/profissional/unidade sem abrir essas tabelas)
create or replace function public.my_appointments() returns table (id uuid, starts_at timestamptz, ends_at timestamptz, status text, service_name text, professional_name text, unit_name text, timezone text, survey_answered boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, lower(a.period), upper(a.period), a.status, s.name, pr.display_name, u.name, u.timezone,
         exists (select 1 from public.survey_responses sr where sr.appointment_id = a.id)
  from public.appointments a join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id join public.units u on u.id = a.unit_id
  where a.person_id = private.current_person() order by lower(a.period) desc limit 100
$$;

create or replace function public.my_packages() returns table (id uuid, product_name text, balance int, total_sessions int, valid_until date, status text)
language sql stable security definer set search_path = '' as $$
  select c.id, p.name, private.package_balance(c.id), c.total_sessions, c.valid_until, c.status
  from public.client_packages c join public.products p on p.id = c.product_id where c.person_id = private.current_person() order by c.created_at desc
$$;

-- Diretório da equipe (gestor / administrador operacional)
create or replace function public.list_team() returns table (user_id uuid, email text, display_name text, status text, roles jsonb)
language sql stable security definer set search_path = '' as $$
  select ua.user_id, ua.email::text, ua.display_name, ua.status,
    coalesce((select jsonb_agg(jsonb_build_object('id', ra.id, 'role', ra.role, 'unit_id', ra.unit_id, 'unit', un.name, 'valid_until', ra.valid_until) order by ra.created_at)
              from public.role_assignments ra left join public.units un on un.id = ra.unit_id where ra.user_id = ua.user_id and ra.revoked_at is null), '[]')
  from public.user_accounts ua where ua.org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[])
  order by ua.created_at
$$;

grant execute on function public.community_post(uuid, text, uuid), public.my_appointments(), public.my_packages(), public.list_team() to authenticated;
