-- HP Group Hub — 015 Superfície de `anon`: fecha as funções criadas nas migrations 011–014 e protege as futuras
-- Achado: o ALTER DEFAULT PRIVILEGES da 010 não impediu que novas funções nascessem executáveis por anon.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.get_public_page(text), public.track_page_visit(uuid, text, jsonb, text), public.submit_public_form(uuid, jsonb, jsonb, text, text) to anon;

-- Verificação reutilizável (usada pelos testes SQL): funções de public executáveis por anon além das 3 públicas.
create or replace function private.anon_extra_functions() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.oid::regprocedure::text order by p.proname), '{}')
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('get_public_page','track_page_visit','submit_public_form')
$$;

-- Guarda automática (best effort): toda função nova em public perde EXECUTE de public/anon.
create or replace function private.guard_new_public_functions() returns event_trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select * from pg_event_trigger_ddl_commands() where command_tag in ('CREATE FUNCTION') and schema_name = 'public' loop
    if r.object_identity !~ '(get_public_page|track_page_visit|submit_public_form)\(' then
      execute format('revoke execute on function %s from public, anon', r.object_identity);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'hp_guard_new_public_functions') then
    create event trigger hp_guard_new_public_functions on ddl_command_end when tag in ('CREATE FUNCTION') execute function private.guard_new_public_functions();
  end if;
exception when others then
  raise notice 'event trigger não criado (%): use private.anon_extra_functions() nos testes e revogue ao fim de cada migration', sqlerrm;
end $$;
