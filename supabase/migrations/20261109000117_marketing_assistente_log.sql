-- HP Group Hub — 117 Marketing: controle de uso do assistente de IA (limite por pessoa) — NÃO guarda o texto das perguntas nem das respostas, só quem perguntou e quando.
create table public.mkt_ai_log (id bigserial primary key, org_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null, at timestamptz not null default now(), question_chars int not null, status text not null default 'asked' check (status in ('asked','answered','error')));
create index mkt_ai_log_user on public.mkt_ai_log (user_id, at desc);
alter table public.mkt_ai_log enable row level security; revoke all on public.mkt_ai_log from anon, authenticated;

-- limite: 6 perguntas por minuto e 120 por dia por pessoa. Devolve o id do registro ou nulo (negado). Só a service role executa.
create or replace function public.mkt_ai_register(p_org uuid, p_user uuid, p_chars int) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if (select count(*) from public.mkt_ai_log where user_id = p_user and at > now() - interval '1 minute') >= 6 then return null; end if;
  if (select count(*) from public.mkt_ai_log where user_id = p_user and at > now() - interval '1 day') >= 120 then return null; end if;
  insert into public.mkt_ai_log (org_id, user_id, question_chars) values (p_org, p_user, least(greatest(coalesce(p_chars, 0), 0), 100000)) returning id into v_id; return v_id;
end $$;
create or replace function public.mkt_ai_finish(p_id bigint, p_status text) returns void language sql security definer set search_path = '' as $$
  update public.mkt_ai_log set status = case when p_status in ('answered','error') then p_status else 'error' end where id = p_id
$$;
revoke all on function public.mkt_ai_register(uuid, uuid, int), public.mkt_ai_finish(bigint, text) from public, anon, authenticated;
grant execute on function public.mkt_ai_register(uuid, uuid, int), public.mkt_ai_finish(bigint, text) to service_role;
