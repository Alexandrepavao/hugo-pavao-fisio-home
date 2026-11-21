-- HP Group Hub — 137 Isolamento do Storage por organização + exportação administrativa (portabilidade).
-- Auditoria: três buckets tinham política só por PAPEL (sem conferir a organização do objeto): academy-private, representation-docs e legal-documents. Agora o primeiro nível do caminho precisa pertencer à organização ativa.
-- Exportação: pacote estruturado do próprio tenant, consistente (uma única instrução = um único snapshot), sem senhas/tokens/chaves, com manifesto, contagens e hashes. Só o gestor da organização exporta (a plataforma NÃO lê os dados).

-- ---------------------------------------------------------------- 1. Storage
drop policy if exists academy_obj_read on storage.objects; drop policy if exists academy_obj_write on storage.objects; drop policy if exists academy_obj_update on storage.objects; drop policy if exists academy_obj_delete on storage.objects;
create policy academy_obj_read on storage.objects for select to authenticated using (bucket_id = 'academy-private' and exists (select 1 from public.courses c where c.id::text = (storage.foldername(name))[1] and c.org_id = (select private.current_org())) and private.can_read_course(private.storage_uuid(name)));
create policy academy_obj_write on storage.objects for insert to authenticated with check (bucket_id = 'academy-private' and private.can_manage_courses() and exists (select 1 from public.courses c where c.id::text = (storage.foldername(name))[1] and c.org_id = (select private.current_org())));
create policy academy_obj_update on storage.objects for update to authenticated using (bucket_id = 'academy-private' and private.can_manage_courses() and exists (select 1 from public.courses c where c.id::text = (storage.foldername(name))[1] and c.org_id = (select private.current_org())))
  with check (bucket_id = 'academy-private' and private.can_manage_courses() and exists (select 1 from public.courses c where c.id::text = (storage.foldername(name))[1] and c.org_id = (select private.current_org())));
create policy academy_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'academy-private' and private.can_manage_courses() and exists (select 1 from public.courses c where c.id::text = (storage.foldername(name))[1] and c.org_id = (select private.current_org())));

drop policy if exists repdocs_obj_read on storage.objects; drop policy if exists repdocs_obj_write on storage.objects; drop policy if exists repdocs_obj_delete on storage.objects;
create policy repdocs_obj_read on storage.objects for select to authenticated using (bucket_id = 'representation-docs' and private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and exists (select 1 from public.care_representations r where r.id::text = (storage.foldername(name))[1] and r.org_id = (select private.current_org())));
create policy repdocs_obj_write on storage.objects for insert to authenticated with check (bucket_id = 'representation-docs' and private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and exists (select 1 from public.care_representations r where r.id::text = (storage.foldername(name))[1] and r.org_id = (select private.current_org())));
create policy repdocs_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'representation-docs' and private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and exists (select 1 from public.care_representations r where r.id::text = (storage.foldername(name))[1] and r.org_id = (select private.current_org())));

drop policy if exists legal_docs_storage_read on storage.objects; drop policy if exists legal_docs_storage_write on storage.objects; drop policy if exists legal_docs_storage_delete on storage.objects;
create policy legal_docs_storage_read on storage.objects for select to authenticated using (bucket_id = 'legal-documents' and private.can_adm_sensitive() and (storage.foldername(name))[1] = (select private.current_org())::text);
create policy legal_docs_storage_write on storage.objects for insert to authenticated with check (bucket_id = 'legal-documents' and private.can_adm_sensitive() and (storage.foldername(name))[1] = (select private.current_org())::text);
create policy legal_docs_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'legal-documents' and private.can_adm_sensitive() and (storage.foldername(name))[1] = (select private.current_org())::text);

-- bucket privado das exportações (primeiro nível = organização). Ninguém lê pela API: só URL assinada emitida pela função (auditada, com expiração)
insert into storage.buckets (id, name, public) values ('org-exports', 'org-exports', false) on conflict (id) do nothing;

-- ---------------------------------------------------------------- 2. registro do que entra na exportação
create table public.platform_export_tables (
  table_name text primary key, kind text not null check (kind in ('org', 'child', 'excluded')), parent_table text, parent_col text, reason text
);
alter table public.platform_export_tables enable row level security; revoke all on public.platform_export_tables from public, anon, authenticated;

create or replace function private.export_registry_refresh() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t record; fk record; v_excl text[] := array['platform_audit', 'provisioning_requests', 'provisioning_steps', 'domain_events', 'automation_runs', 'route_leg_cache', 'route_usage', 'view_as_sessions', 'portal_invites', 'org_exports', 'physio_areas', 'specialties'];
        n_org int := 0; n_child int := 0; n_excl int := 0;
begin
  truncate public.platform_export_tables;
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1 loop
    if t.relname = any (v_excl) or t.relname like 'platform\_%' or t.relname like 'pf\_%' then
      insert into public.platform_export_tables (table_name, kind, reason) values (t.relname, 'excluded', case when t.relname like 'pf\_%' then 'dados pessoais do usuário (não pertencem à empresa)' when t.relname like 'platform\_%' then 'administração da plataforma' else 'interno/derivado (fila, cache, sessão de suporte ou log técnico)' end);
      n_excl := n_excl + 1;
    elsif exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = t.relname and k.column_name = 'org_id') then
      insert into public.platform_export_tables (table_name, kind) values (t.relname, 'org'); n_org := n_org + 1;
    end if;
  end loop;
  -- filhas sem org_id: herdam a organização pelo vínculo com uma tabela da organização (até 3 níveis)
  for i in 1..3 loop
    for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not exists (select 1 from public.platform_export_tables e where e.table_name = c.relname) order by 1 loop
      select cl.relname child, a.attname child_col, pl.relname parent into fk
        from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_class pl on pl.oid = k.confrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1] join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
       where k.contype = 'f' and cl.relname = t.relname and pl.relnamespace = 'public'::regnamespace and pa.attname = 'id' and array_length(k.conkey, 1) = 1
         and exists (select 1 from public.platform_export_tables e where e.table_name = pl.relname and e.kind in ('org', 'child')) order by (select kind from public.platform_export_tables e where e.table_name = pl.relname) limit 1;
      if found then insert into public.platform_export_tables (table_name, kind, parent_table, parent_col) values (t.relname, 'child', fk.parent, fk.child_col); n_child := n_child + 1; end if;
    end loop;
  end loop;
  insert into public.platform_export_tables (table_name, kind, reason)
    select c.relname, 'excluded', 'catálogo global da plataforma ou dado de usuário (sem vínculo com uma organização)' from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not exists (select 1 from public.platform_export_tables e where e.table_name = c.relname);
  get diagnostics n_excl = row_count;
  return jsonb_build_object('org', n_org, 'child', n_child, 'excluded_total', (select count(*) from public.platform_export_tables where kind = 'excluded'));
end $$;
select private.export_registry_refresh();

-- predicado de escopo (recursivo) para uma tabela do registro
create or replace function private.export_scope(p_table text, p_alias text, p_depth int default 0) returns text language plpgsql stable security definer set search_path = '' as $$
declare e public.platform_export_tables;
begin
  select * into e from public.platform_export_tables where table_name = p_table;
  if e.kind = 'org' then return format('%I.org_id = $1', p_alias); end if;
  if e.kind = 'child' and p_depth < 4 then return format('%I.%I in (select p.id from public.%I p where %s)', p_alias, e.parent_col, e.parent_table, private.export_scope(e.parent_table, 'p', p_depth + 1)); end if;
  return 'false';
end $$;

-- ---------------------------------------------------------------- 3. construção CONSISTENTE (uma única instrução ⇒ um único snapshot), sem credenciais
create or replace function private.org_export_build(p_org uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_sql text := ''; v_cols text; v_sens text := '(token|secret|password|passwd|api_key|apikey|encrypted|enc_key|auth_key|p256dh|endpoint|private_key|access_key)'; v_out jsonb; v_est bigint; v_groups text[] := '{}'; v_cur text := ''; v_n int := 0;
begin
  if p_org is null then raise exception 'organização inválida'; end if;
  select coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint into v_est from pg_class c join public.platform_export_tables x on x.table_name = c.relname where x.kind <> 'excluded' and c.relnamespace = 'public'::regnamespace;
  if v_est > 800000 then raise exception 'organização grande demais para a exportação em uma única instrução (estimativa % linhas): exportação por lotes ainda não implementada', v_est; end if;
  for e in select * from public.platform_export_tables where kind <> 'excluded' order by table_name loop
    select coalesce(string_agg(format('- %L', column_name), ' '), '') into v_cols from information_schema.columns where table_schema = 'public' and table_name = e.table_name and column_name ~* v_sens;
    v_cur := v_cur || format('%s%L, coalesce((select jsonb_agg(to_jsonb(t) %s) from public.%I t where %s), ''[]''::jsonb)', case when v_cur = '' then '' else ', ' end, e.table_name, v_cols, e.table_name, private.export_scope(e.table_name, 't'));
    v_n := v_n + 1;
    if v_n >= 40 then v_groups := v_groups || v_cur; v_cur := ''; v_n := 0; end if;       -- jsonb_build_object aceita no máximo 100 argumentos: grupos de 40 tabelas, ainda UMA instrução
  end loop;
  if v_cur <> '' then v_groups := v_groups || v_cur; end if;
  select string_agg(format('jsonb_build_object(%s)', g), ' || ') into v_sql from unnest(v_groups) g;
  execute 'select ' || v_sql into v_out using p_org;
  return v_out;
end $$;

create table public.org_exports (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade, requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'requested' check (status in ('requested', 'ready', 'failed', 'expired')), schema_version text, counts jsonb not null default '{}', size_bytes bigint, sha256 text, storage_path text,
  created_at timestamptz not null default now(), expires_at timestamptz, downloads int not null default 0, last_download_at timestamptz, error text check (error is null or length(error) <= 300)
);
create index org_exports_org_idx on public.org_exports (org_id, created_at desc);
alter table public.org_exports enable row level security; revoke all on public.org_exports from public, anon, authenticated;

-- o gestor (dono dos dados) autoriza e registra o pedido; a plataforma NÃO exporta dados de clínica
create or replace function public.org_export_request() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid;
begin
  if v_org is null or not private.has_org_role(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.org_exports (org_id, requested_by) values (v_org, (select auth.uid())) returning id into v_id;
  perform private.platform_audit('export.request', v_org, 'export', v_id::text, '{}');
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns) values (v_org, (select auth.uid()), 'export_request', 'org_export', v_id::text, array['export']);
  return jsonb_build_object('id', v_id, 'org_id', v_org);
end $$;
create or replace function public.org_export_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_org_role(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'created_at', x.created_at, 'expires_at', x.expires_at, 'size_bytes', x.size_bytes, 'sha256', x.sha256, 'schema_version', x.schema_version, 'downloads', x.downloads, 'counts', x.counts) order by x.created_at desc)
                     from (select * from public.org_exports where org_id = private.current_org() order by created_at desc limit 50) x), '[]'::jsonb);
end $$;
-- execução (service_role, chamada pela Edge Function depois de autorizar o gestor)
create or replace function public.org_export_run(p_export uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.org_exports; v_data jsonb; v_counts jsonb;
begin
  select * into x from public.org_exports where id = p_export; if not found then raise exception 'exportação não encontrada'; end if;
  v_data := private.org_export_build(x.org_id);
  select jsonb_object_agg(k, jsonb_array_length(v)) into v_counts from jsonb_each(v_data) e(k, v);
  return jsonb_build_object('org_id', x.org_id, 'data', v_data, 'counts', v_counts,
    'schema_version', (select max(version) from supabase_migrations.schema_migrations),
    'excluded', (select coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'reason', reason) order by table_name), '[]') from public.platform_export_tables where kind = 'excluded'),
    'files', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name, 'size', (o.metadata ->> 'size')::bigint)) from storage.objects o where o.bucket_id in ('accounting-private', 'org-brand', 'legal-documents', 'representation-docs') and split_part(o.name, '/', 1) = x.org_id::text), '[]'));
end $$;
create or replace function public.org_export_done(p_export uuid, p_status text, p_path text, p_size bigint, p_sha text, p_counts jsonb, p_schema text, p_error text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.org_exports set status = p_status, storage_path = p_path, size_bytes = p_size, sha256 = p_sha, counts = coalesce(p_counts, '{}'), schema_version = p_schema, error = left(p_error, 300), expires_at = now() + interval '7 days' where id = p_export;
end $$;
create or replace function public.org_export_download_logged(p_export uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.org_exports;
begin
  select * into x from public.org_exports where id = p_export for update;
  if not found or x.status <> 'ready' or x.expires_at <= now() then raise exception 'exportação indisponível ou expirada' using errcode = '42501'; end if;
  update public.org_exports set downloads = downloads + 1, last_download_at = now() where id = p_export;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns) values (x.org_id, x.requested_by, 'export_download', 'org_export', p_export::text, array['export']);
  return jsonb_build_object('path', x.storage_path, 'org_id', x.org_id);
end $$;

revoke all on function private.export_registry_refresh(), private.export_scope(text, text, int), private.org_export_build(uuid) from public, anon, authenticated;
revoke all on function public.org_export_request(), public.org_export_list(), public.org_export_run(uuid), public.org_export_done(uuid, text, text, bigint, text, jsonb, text, text), public.org_export_download_logged(uuid) from public, anon, authenticated;
grant execute on function public.org_export_request(), public.org_export_list() to authenticated;
grant execute on function public.org_export_run(uuid), public.org_export_done(uuid, text, text, bigint, text, jsonb, text, text), public.org_export_download_logged(uuid) to service_role;

select private.export_registry_refresh();      -- inclui as tabelas criadas neste arquivo
