-- HP Group Hub — 128 "Ver como": o gestor (dono) vê o app do fisioterapeuta ou do paciente exatamente como essa pessoa vê, SOMENTE LEITURA e com registro de cada sessão.
--
-- Como funciona (decisões do proprietário, 14/11/2026: somente olhar · só o gestor · dado clínico do paciente visível, com registro):
--  1. O gestor abre uma SESSÃO de "ver como" (view_as_start) para uma pessoa que tem acesso ao app (fisioterapeuta ou paciente). A sessão fica gravada (quem, como quem, quando) e vale 4 horas.
--  2. O site manda o cabeçalho `x-view-as: <id da sessão>` em todas as chamadas. Uma função de pré-requisição do PostgREST (hp_pre_request) confere que a sessão é do usuário logado, está aberta e que ele ainda é gestor;
--     então troca a identidade da chamada (auth.uid() passa a ser a da pessoa vista) — assim TODAS as telas, funções e políticas de acesso (RLS) respondem como responderiam à pessoa — e coloca a transação em
--     modo SOMENTE LEITURA: qualquer gravação falha no servidor ("cannot execute … in a read-only transaction"). Nada é feito em nome da pessoa.
--  3. Cabeçalho inválido, de outra pessoa, expirado ou de sessão encerrada = erro 42501 (nunca "cai" para a identidade do gestor). Sem o cabeçalho, a função não faz nada.
--  4. Só se vê como: fisioterapeuta (papel physio, sem papel de gestão) e paciente (papel member, sem papel de equipe). Nunca como gestor, administrativo, financeiro etc.
--  5. Ver como paciente também grava um registro de acesso clínico (clinical_access_log, papel 'admin', escopo 'ver_como'), no mesmo lugar dos demais acessos clínicos do gestor.
-- Nada existente é removido; private.log_clinical_access passa a não gravar quando está em "ver como" (a sessão já é o registro, e a transação é somente leitura).

-- ---------------------------------------------------------------- sessões (auditoria)
create table if not exists public.view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  viewer_user_id uuid not null,
  target_user_id uuid not null,
  target_person_id uuid,
  target_kind text not null check (target_kind in ('physio', 'patient')),
  target_name text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours'),
  ended_at timestamptz,
  ended_reason text
);
create index if not exists view_as_sessions_viewer_idx on public.view_as_sessions (viewer_user_id, started_at desc);
create index if not exists view_as_sessions_target_idx on public.view_as_sessions (target_user_id, started_at desc);
alter table public.view_as_sessions enable row level security;
-- sem política de leitura e sem permissão direta: a tabela só é lida/gravada pelas funções abaixo (security definer), que conferem que quem chama é o gestor
revoke all on public.view_as_sessions from public, anon, authenticated;

-- ---------------------------------------------------------------- auxiliares
create or replace function private.view_as_active() returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'view_as_by', '') <> ''
$$;
grant execute on function private.view_as_active() to authenticated, anon;

-- tipo de quem pode ser visto: 'physio', 'patient' ou nulo (qualquer outro papel não pode)
create or replace function private.view_as_target_kind(p_user uuid) returns text language sql stable security definer set search_path = '' as $$
  with r as (select ra.role from public.role_assignments ra where ra.user_id = p_user and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()))
  select case
    when not exists (select 1 from public.user_accounts ua where ua.user_id = p_user and ua.status = 'active') then null
    when exists (select 1 from r where role = 'physio') and not exists (select 1 from r where role in ('manager', 'ops_admin', 'unit_manager', 'sales', 'finance')) then 'physio'
    when exists (select 1 from r where role = 'member') and not exists (select 1 from r where role in ('manager', 'ops_admin', 'unit_manager', 'sales', 'finance', 'physio', 'teacher')) then 'patient'
    else null end
$$;
revoke all on function private.view_as_target_kind(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- iniciar / encerrar / consultar
create or replace function public.view_as_start(p_target uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); k text; ua public.user_accounts; s public.view_as_sessions; v_roles jsonb;
begin
  if v_uid is null or private.view_as_active() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.has_role_any(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ua from public.user_accounts where user_id = p_target and org_id = v_org and status = 'active';
  if not found then raise exception 'Esta pessoa não tem acesso ao app.' using errcode = 'P0001'; end if;
  k := private.view_as_target_kind(p_target);
  if k is null then raise exception 'Só é possível ver como fisioterapeuta ou paciente.' using errcode = 'P0001'; end if;
  update public.view_as_sessions set ended_at = now(), ended_reason = 'nova sessão' where viewer_user_id = v_uid and ended_at is null;
  insert into public.view_as_sessions (org_id, viewer_user_id, target_user_id, target_person_id, target_kind, target_name)
    values (v_org, v_uid, p_target, ua.person_id, k, coalesce(ua.display_name, (select pe.full_name from public.people pe where pe.id = ua.person_id))) returning * into s;
  if k = 'patient' and ua.person_id is not null then perform private.log_clinical_access(ua.person_id, 'admin', 'ver_como'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('role', ra.role, 'unit_id', ra.unit_id)), '[]'::jsonb) into v_roles
    from public.role_assignments ra where ra.user_id = p_target and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now());
  return jsonb_build_object('session_id', s.id, 'target_user_id', p_target, 'target_person_id', ua.person_id, 'name', s.target_name, 'kind', k, 'roles', v_roles, 'expires_at', s.expires_at);
end $$;
revoke all on function public.view_as_start(uuid) from public, anon;
grant execute on function public.view_as_start(uuid) to authenticated;

-- encerrar: precisa ser chamada SEM o cabeçalho (como o próprio gestor), porque com ele a transação é somente leitura
create or replace function public.view_as_end(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.view_as_active() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.view_as_sessions set ended_at = now(), ended_reason = 'encerrada' where id = p_session and viewer_user_id = (select auth.uid()) and ended_at is null;
end $$;
revoke all on function public.view_as_end(uuid) from public, anon;
grant execute on function public.view_as_end(uuid) to authenticated;

-- a sessão em uso nesta chamada (só devolve algo com o cabeçalho válido): quem está sendo visto, papéis e validade
create or replace function public.view_as_current() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; s public.view_as_sessions; v_roles jsonb; v_email text;
begin
  begin v_id := nullif(current_setting('app.view_as_session', true), '')::uuid; exception when others then v_id := null; end;
  if v_id is null then return null; end if;
  select * into s from public.view_as_sessions where id = v_id;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('role', ra.role, 'unit_id', ra.unit_id)), '[]'::jsonb) into v_roles
    from public.role_assignments ra where ra.user_id = s.target_user_id and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now());
  select u.email into v_email from auth.users u where u.id = s.target_user_id;
  return jsonb_build_object('session_id', s.id, 'target_user_id', s.target_user_id, 'target_person_id', s.target_person_id, 'name', s.target_name, 'email', v_email, 'kind', s.target_kind,
                            'roles', v_roles, 'started_at', s.started_at, 'expires_at', s.expires_at);
end $$;
revoke all on function public.view_as_current() from public, anon;
grant execute on function public.view_as_current() to authenticated;

-- quem pode ser visto (com acesso ao app) e as últimas sessões: só o gestor
create or replace function public.view_as_targets(p_kind text, p_q text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); res jsonb; q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if (select auth.uid()) is null or private.view_as_active() or not private.has_role_any(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind not in ('physio', 'patient') then raise exception 'tipo inválido'; end if;
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into res from (
    select jsonb_build_object('user_id', ua.user_id, 'person_id', ua.person_id, 'name', coalesce(ua.display_name, pe.full_name), 'email', u.email, 'last_sign_in_at', u.last_sign_in_at) x
      from public.user_accounts ua left join public.people pe on pe.id = ua.person_id left join auth.users u on u.id = ua.user_id
     where ua.org_id = v_org and ua.status = 'active' and private.view_as_target_kind(ua.user_id) = p_kind
       and (q is null or coalesce(ua.display_name, pe.full_name, '') ilike '%' || q || '%' or coalesce(u.email, '') ilike '%' || q || '%')
     order by coalesce(ua.display_name, pe.full_name) limit least(greatest(coalesce(p_limit, 50), 1), 200)) t;
  return res;
end $$;
revoke all on function public.view_as_targets(text, text, int) from public, anon;
grant execute on function public.view_as_targets(text, text, int) to authenticated;

create or replace function public.view_as_sessions_recent(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if (select auth.uid()) is null or private.view_as_active() or not private.has_role_any(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'viewer', coalesce(va.display_name, 'Gestor'), 'target', s.target_name, 'kind', s.target_kind, 'started_at', s.started_at, 'ended_at', s.ended_at, 'ended_reason', s.ended_reason, 'expires_at', s.expires_at) order by s.started_at desc), '[]'::jsonb) into res
    from (select * from public.view_as_sessions where org_id = private.current_org() order by started_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) s
    left join public.user_accounts va on va.user_id = s.viewer_user_id;
  return res;
end $$;
revoke all on function public.view_as_sessions_recent(int) from public, anon;
grant execute on function public.view_as_sessions_recent(int) to authenticated;

-- ---------------------------------------------------------------- registro de acesso clínico: em "ver como" não grava (a sessão é o registro)
create or replace function private.log_clinical_access(p_person uuid, p_role text, p_scope text) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or private.view_as_active() then return; end if;
  if exists (select 1 from public.clinical_access_log l where l.accessed_by = v_uid and l.person_id = p_person and l.scope = p_scope and l.at > now() - interval '10 minutes') then return; end if;
  insert into public.clinical_access_log (org_id, person_id, accessed_by, accessed_by_role, scope) values (private.current_org(), p_person, v_uid, p_role, p_scope);
end $$;

-- ---------------------------------------------------------------- pré-requisição do PostgREST: troca a identidade e liga o modo somente leitura
-- Sem o cabeçalho x-view-as, não faz NADA (retorna na primeira linha útil). Com o cabeçalho, valida tudo ou recusa com 42501.
create or replace function public.hp_pre_request() returns void
language plpgsql security definer set search_path = '' as $$
declare h text; v_claims jsonb; v_real uuid; s public.view_as_sessions; v_id uuid;
begin
  begin h := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-view-as'), ''); exception when others then h := null; end;
  if h is null then return; end if;
  begin
    v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    v_real := nullif(v_claims ->> 'sub', '')::uuid; v_id := h::uuid;
    select * into s from public.view_as_sessions where id = v_id;
  exception when others then raise exception 'ver como inválido' using errcode = '42501'; end;
  if v_real is null or s.id is null or s.viewer_user_id <> v_real or s.ended_at is not null or s.expires_at <= now() or v_claims ? 'view_as_by' then
    raise exception 'ver como inválido ou expirado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
                  where ra.user_id = v_real and ra.role = 'manager' and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())) then
    raise exception 'ver como inválido ou expirado' using errcode = '42501';
  end if;
  if private.view_as_target_kind(s.target_user_id) is distinct from s.target_kind then raise exception 'ver como inválido ou expirado' using errcode = '42501'; end if;
  v_claims := (v_claims - 'email' - 'phone') || jsonb_build_object('sub', s.target_user_id::text, 'view_as_by', v_real::text);
  perform set_config('request.jwt.claims', v_claims::text, true);
  perform set_config('request.jwt.claim.sub', s.target_user_id::text, true);
  perform set_config('app.view_as_session', s.id::text, true);
  perform set_config('transaction_read_only', 'on', true);
end $$;
revoke all on function public.hp_pre_request() from public;
grant execute on function public.hp_pre_request() to anon, authenticated, service_role;

-- liga a função como pré-requisição do PostgREST (só depois de a função existir e ter permissão) e recarrega a configuração
alter role authenticator set pgrst.db_pre_request = 'public.hp_pre_request';
notify pgrst, 'reload config';
