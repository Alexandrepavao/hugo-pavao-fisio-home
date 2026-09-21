-- HP Group Hub — 010 Privilégios de EXECUTE: anon apenas nas 3 RPCs públicas (inclusive para funções futuras)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.get_public_page(text), public.track_page_visit(uuid, text, jsonb, text), public.submit_public_form(uuid, jsonb, jsonb, text, text) to anon;

do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    begin
      execute format('alter default privileges for role %I in schema public revoke execute on functions from public, anon', r);
    exception when others then
      raise notice 'default privileges de % não alterados: %', r, sqlerrm;
    end;
  end loop;
end $$;
