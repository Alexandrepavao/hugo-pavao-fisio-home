-- HP Group Hub — 014 Apoio ao envio de e-mails transacionais (autorização checada no banco)
create or replace function public.can_send_transactional() returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_staff() $$;
grant execute on function public.can_send_transactional() to authenticated;
