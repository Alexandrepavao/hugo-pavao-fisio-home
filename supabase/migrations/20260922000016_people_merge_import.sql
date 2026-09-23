-- HP Group Hub — 016 Mesclagem de pessoas (prévia + histórico preservado) e importação com validação
-- Mesclagem SEMPRE exige decisão explícita e nunca apaga o cadastro mesclado: ele fica arquivado com merged_into_id.

create table public.person_merges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  kept_person_id uuid not null references public.people(id) on delete restrict,
  merged_person_id uuid not null references public.people(id) on delete restrict,
  merged_snapshot jsonb not null,        -- dados do cadastro mesclado no momento da mesclagem (nome, contatos, tipos)
  moved jsonb not null,                  -- quantidade de registros movidos por tabela
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
alter table public.person_merges enable row level security;
grant select on public.person_merges to authenticated;
create policy merges_read on public.person_merges for select to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));

-- Tabelas que referenciam people por uma única coluna (descobertas pelo catálogo: novas tabelas entram automaticamente)
create or replace function private.people_fk_columns() returns table (tbl text, col text)
language sql stable set search_path = '' as $$
  select c.conrelid::regclass::text, a.attname::text
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'public.people'::regclass and c.conrelid <> 'public.people'::regclass and array_length(c.conkey, 1) = 1
$$;

create or replace function public.merge_preview(p_keep uuid, p_merge uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); k public.people; g public.people; r record; n bigint; moves jsonb := '{}'; conflicts jsonb := '[]';
begin
  select * into k from public.people where id = p_keep and org_id = v_org and merged_into_id is null;
  select * into g from public.people where id = p_merge and org_id = v_org and merged_into_id is null;
  if k.id is null or g.id is null or p_keep = p_merge then raise exception 'cadastros inválidos para mesclagem'; end if;
  if not (private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], k.unit_id)
      and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], g.unit_id)) then
    raise exception 'sem permissão para mesclar estes cadastros' using errcode = '42501'; end if;

  if exists (select 1 from public.user_accounts where person_id = p_keep) and exists (select 1 from public.user_accounts where person_id = p_merge) then
    conflicts := conflicts || jsonb_build_object('level', 'block', 'message', 'Os dois cadastros têm conta de acesso. Contas não podem ser mescladas: revogue uma delas antes.'); end if;
  if exists (select 1 from public.partner_profiles where person_id = p_keep) and exists (select 1 from public.partner_profiles where person_id = p_merge) then
    conflicts := conflicts || jsonb_build_object('level', 'block', 'message', 'Os dois cadastros têm perfil de parceiro. Resolva antes de mesclar.'); end if;
  if k.document_number is not null and g.document_number is not null and k.document_number <> g.document_number then
    conflicts := conflicts || jsonb_build_object('level', 'block', 'message', 'Documentos diferentes nos dois cadastros: provavelmente são pessoas distintas.'); end if;
  if exists (select 1 from public.appointments a1 join public.appointments a2 on a1.period && a2.period
             where a1.person_id = p_keep and a2.person_id = p_merge and a1.status in ('scheduled','confirmed','attended') and a2.status in ('scheduled','confirmed','attended')) then
    conflicts := conflicts || jsonb_build_object('level', 'block', 'message', 'Há agendamentos sobrepostos entre os dois cadastros. Remarque ou cancele um deles antes.'); end if;
  if k.birth_date is not null and g.birth_date is not null and k.birth_date <> g.birth_date then
    conflicts := conflicts || jsonb_build_object('level', 'warn', 'message', 'Datas de nascimento diferentes: será mantida a do cadastro preservado.'); end if;
  if extensions.similarity(lower(k.full_name), lower(g.full_name)) < 0.4 then
    conflicts := conflicts || jsonb_build_object('level', 'warn', 'message', 'Os nomes são muito diferentes. Confirme que se trata da mesma pessoa.'); end if;
  if exists (select 1 from public.person_contacts c where c.person_id = p_merge and c.is_shared) then
    conflicts := conflicts || jsonb_build_object('level', 'warn', 'message', 'O cadastro mesclado tem contato marcado como compartilhado (familiar). Confira antes de continuar.'); end if;

  for r in select * from private.people_fk_columns() loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_merge;
    if n > 0 then moves := moves || jsonb_build_object(replace(r.tbl, 'public.', '') || '.' || r.col, n); end if;
  end loop;

  return jsonb_build_object('keep', jsonb_build_object('id', k.id, 'name', k.full_name), 'merge', jsonb_build_object('id', g.id, 'name', g.full_name),
    'moves', moves, 'conflicts', conflicts, 'can_merge', not exists (select 1 from jsonb_array_elements(conflicts) x where x ->> 'level' = 'block'));
end $$;

create or replace function public.merge_people(p_keep uuid, p_merge uuid, p_accept_warnings boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); pv jsonb := public.merge_preview(p_keep, p_merge); k public.people; g public.people; r record; t record; v_snap jsonb;
begin
  if not (pv ->> 'can_merge')::boolean then raise exception 'Mesclagem bloqueada por conflito: revise a prévia.'; end if;
  if exists (select 1 from jsonb_array_elements(pv -> 'conflicts') x where x ->> 'level' = 'warn') and not coalesce(p_accept_warnings, false) then
    raise exception 'Confirme os avisos da prévia para continuar.'; end if;
  select * into k from public.people where id = p_keep for update;
  select * into g from public.people where id = p_merge for update;
  select jsonb_build_object('full_name', g.full_name, 'document_number', g.document_number, 'birth_date', g.birth_date, 'notes', g.notes,
      'contacts', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'value', value)) from public.person_contacts where person_id = p_merge), '[]'),
      'kinds', coalesce((select jsonb_agg(kind) from public.person_kinds where person_id = p_merge), '[]')) into v_snap;

  update public.person_contacts set is_primary = false where person_id = p_merge;      -- evita conflito do "contato principal único"
  for r in select * from private.people_fk_columns() loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_merge;
    exception when unique_violation or check_violation then
      -- conflito em tabela de vínculo (ex.: mesma tag/contato/progresso nos dois): move linha a linha e descarta só o duplicado
      for t in execute format('select ctid as id from %s where %I = $1', r.tbl, r.col) using p_merge loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using p_keep, t.id;
        exception when unique_violation or check_violation then
          execute format('delete from %s where ctid = $1', r.tbl) using t.id;
        end;
      end loop;
    end;
  end loop;

  update public.people set merged_into_id = p_keep, archived_at = now() where id = p_merge;
  update public.people set document_number = coalesce(document_number, g.document_number), birth_date = coalesce(birth_date, g.birth_date),
      notes = case when g.notes is null then notes else coalesce(notes || E'\n', '') || '[Mesclado] ' || g.notes end where id = p_keep;
  insert into public.person_merges (org_id, kept_person_id, merged_person_id, merged_snapshot, moved, actor_user_id)
    values (v_org, p_keep, p_merge, v_snap, pv -> 'moves', (select auth.uid()));
  insert into public.interactions (org_id, person_id, unit_id, channel, summary, created_by)
    values (v_org, p_keep, k.unit_id, 'system', 'Cadastro "' || g.full_name || '" mesclado neste cadastro.', (select auth.uid()));
  return jsonb_build_object('status', 'merged', 'moved', pv -> 'moves');
end $$;

-- ---------------------------------------------------------------- importação com prévia e relatório
-- Entrada: [{"name","email","phone","kind"}]. Máx. 500 linhas por lote. Duplicidade por contato/nome semelhante nunca é importada sem decisão.
create or replace function public.import_people_check(p_rows jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare i int := 0; x jsonb; d record; out jsonb := '[]';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'envie até 500 linhas por lote'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    select * into d from public.find_person_duplicates(coalesce(x ->> 'name', ''), array[x ->> 'email'], array[x ->> 'phone']) limit 1;
    out := out || jsonb_build_object('idx', i, 'duplicate', d.person_id is not null, 'reason', d.match_reason, 'existing', case when d.visible then d.full_name end);
    i := i + 1;
  end loop;
  return out;
end $$;

create or replace function public.import_people_commit(p_unit uuid, p_rows jsonb, p_force_idx int[] default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare i int := 0; x jsonb; res jsonb; out jsonb := '[]'; k public.person_kind;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'envie até 500 linhas por lote'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    begin
      k := coalesce(nullif(x ->> 'kind', ''), 'lead')::public.person_kind;
      res := public.create_person(x ->> 'name', p_unit, array[k], nullif(x ->> 'email', ''), nullif(x ->> 'phone', ''), null, i = any (coalesce(p_force_idx, '{}')));
      out := out || jsonb_build_object('idx', i, 'status', case res ->> 'status' when 'created' then 'created' else 'duplicate' end);
    exception when others then
      out := out || jsonb_build_object('idx', i, 'status', 'error', 'message', sqlerrm);
    end;
    i := i + 1;
  end loop;
  return out;
end $$;

grant execute on function public.merge_preview(uuid, uuid), public.merge_people(uuid, uuid, boolean), public.import_people_check(jsonb), public.import_people_commit(uuid, jsonb, int[]) to authenticated;
