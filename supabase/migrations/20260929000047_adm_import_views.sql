-- HP Group Hub — 047 ADM: importação CSV de pessoas jurídicas, preferências de colunas por usuário e
-- permissão de campos na listagem/exportação. Reaproveita legal_entities/legal_entity_units (045), can_adm /
-- can_adm_sensitive e adm_directory (046). Nada aqui cria base paralela de empresas.

-- ---------------------------------------------------------------- auditoria de PJ (faltava desde a 045)
create trigger audit_legal_entities after insert or update on public.legal_entities
  for each row execute function private.audit_row('legal_name','cnpj','registration_status','merged_into_id','archived_at');

-- ---------------------------------------------------------------- catálogo de colunas e permissão de campo
-- sensitive = só manager/ops_admin (private.can_adm_sensitive) veem o valor; os demais recebem null.
create or replace function private.adm_column_catalog()
returns table (key text, label text, sensitive boolean, default_visible boolean, pos int)
language sql immutable set search_path = '' as $$
  values
    ('name'::text,               'Nome / razão social'::text, false, true,  1),
    ('type',                     'Tipo (PF/PJ)',               false, true,  2),
    ('document',                 'Documento',                  false, true,  3),
    ('email',                    'E-mail',                     false, false, 4),
    ('phone',                    'Telefone',                   false, false, 5),
    ('city',                     'Cidade/UF',                  false, true,  6),
    ('units',                    'Unidade(s)',                 false, true,  7),
    ('status',                   'Status',                     false, true,  8),
    ('complete',                 'Completo',                   false, true,  9),
    ('created_at',               'Criado em',                  false, true,  10),
    ('kinds',                    'Vínculos (PF)',              false, false, 11),
    ('trade_name',               'Nome fantasia (PJ)',         false, false, 12),
    ('origin',                   'Origem',                     false, false, 13),
    ('tax_regime',               'Regime tributário (PJ)',     true,  false, 14),
    ('state_registration',       'Inscrição estadual (PJ)',    true,  false, 15),
    ('email_finance',            'E-mail financeiro (PJ)',     true,  false, 16)
$$;

-- ---------------------------------------------------------------- preferências por usuário
create table public.adm_view_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  view_key text not null,
  columns text[] not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, view_key)
);
alter table public.adm_view_prefs enable row level security;
grant select on public.adm_view_prefs to authenticated;   -- escrita só pelas RPCs abaixo
create policy adm_view_prefs_own on public.adm_view_prefs for select to authenticated
  using (user_id = (select auth.uid()) and private.in_org(org_id));

create or replace function public.adm_columns_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_full boolean := private.can_adm_sensitive();
begin
  if not private.can_adm() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'sensitive', c.sensitive,
            'allowed', (not c.sensitive) or v_full, 'default_visible', c.default_visible) order by c.pos)
          from private.adm_column_catalog() c);
end $$;

-- devolve as colunas visíveis, na ordem salva, já filtradas pela permissão ATUAL (se o papel mudou, a coluna some)
create or replace function public.adm_view_get(p_view text default 'diretorio') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_full boolean := private.can_adm_sensitive(); v_saved text[]; v_cols text[]; v_default boolean := true;
begin
  if not private.can_adm() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select columns into v_saved from public.adm_view_prefs where user_id = (select auth.uid()) and view_key = p_view;
  if v_saved is not null then
    v_default := false;
    select coalesce(array_agg(k order by ord), '{}') into v_cols
      from unnest(v_saved) with ordinality t(k, ord)
      join private.adm_column_catalog() c on c.key = t.k and ((not c.sensitive) or v_full);
  end if;
  if v_saved is null or coalesce(array_length(v_cols, 1), 0) = 0 then
    v_default := true;
    select array_agg(key order by pos) into v_cols from private.adm_column_catalog() where default_visible;
  end if;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'is_default', v_default);
end $$;

create or replace function public.adm_view_save(p_columns text[], p_view text default 'diretorio') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_full boolean := private.can_adm_sensitive(); v_clean text[];
begin
  if not private.can_adm() then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- valida contra o catálogo, descarta duplicados e colunas sensíveis sem permissão; 'name' é sempre mantida
  select array_agg(k order by ord) into v_clean from (
    select t.k, min(t.ord) as ord from unnest(coalesce(p_columns, '{}')) with ordinality t(k, ord)
      join private.adm_column_catalog() c on c.key = t.k and ((not c.sensitive) or v_full)
      group by t.k) x;
  if v_clean is null or not ('name' = any (v_clean)) then v_clean := array['name'] || coalesce(v_clean, '{}'); end if;
  insert into public.adm_view_prefs (user_id, org_id, view_key, columns)
    values ((select auth.uid()), private.current_org(), p_view, v_clean)
    on conflict (user_id, view_key) do update set columns = excluded.columns, updated_at = now();
  return jsonb_build_object('columns', to_jsonb(v_clean), 'is_default', false);
end $$;

create or replace function public.adm_view_reset(p_view text default 'diretorio') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_adm() then raise exception 'sem permissão' using errcode = '42501'; end if;
  delete from public.adm_view_prefs where user_id = (select auth.uid()) and view_key = p_view;
  return public.adm_view_get(p_view);
end $$;

-- ---------------------------------------------------------------- listagem: campos extras com permissão de campo
-- Mesma função da 046, agora devolvendo também as colunas opcionais. Campos sensíveis viram null no SERVIDOR
-- para quem não é manager/ops_admin — a interface nunca é a barreira.
create or replace function public.adm_directory(
  p_search text default null, p_type text default null, p_kind public.person_kind default null,
  p_unit uuid default null, p_status text default null, p_incomplete_only boolean default false,
  p_sort text default 'created_at', p_dir text default 'desc', p_page int default 0, p_page_size int default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); u uuid[]; v_full boolean := private.can_adm_sensitive();
  v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb; v_total bigint;
  v_sort text; v_dir text := case when lower(coalesce(p_dir,'desc')) = 'asc' then 'asc' else 'desc' end;
  v_page_size int := least(greatest(coalesce(p_page_size, 25), 1), 100); v_page int := greatest(coalesce(p_page, 0), 0);
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := case when private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
         (select array_agg(id) from public.units where org_id = v_org and (p_unit is null or id = p_unit))
       else (select array_agg(distinct ra.unit_id) from public.role_assignments ra
               where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','sales']::public.app_role[]) and ra.unit_id is not null and ra.revoked_at is null
                 and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit)) end;
  v_sort := case when p_sort in ('name','created_at','city') then p_sort else 'created_at' end;

  with base as (
    (
      select p.id, 'pf'::text as type, p.full_name as name, p.document_number as doc,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type = 'email' order by c.is_primary desc limit 1) as email,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type in ('phone','whatsapp') order by c.is_primary desc limit 1) as phone,
        p.city, p.state_uf as uf, p.registration_status as status, p.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id = p.unit_id or un.id in (select unit_id from public.person_units pu where pu.person_id = p.id)) as unit_names,
        private.person_is_complete(p.id) as complete,
        coalesce((select array_agg(k.kind::text) from public.person_kinds k where k.person_id = p.id), '{}') as kinds,
        null::text as trade_name, p.origin, null::text as tax_regime, null::text as state_registration, null::text as email_finance
      from public.people p
      where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
        and (p_unit is null or p.unit_id = any(u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any(u)))
        and (p_status is null or p.registration_status = p_status)
        and (p_kind is null or exists (select 1 from public.person_kinds k where k.person_id = p.id and k.kind = p_kind))
        and (v_search is null or p.full_name ilike '%' || v_search || '%'
             or (regexp_replace(v_search, '\D', '', 'g') <> '' and p.document_number like '%' || regexp_replace(v_search, '\D', '', 'g') || '%')
             or exists (select 1 from public.person_contacts c where c.person_id = p.id and (c.value ilike '%' || v_search || '%' or c.normalized ilike '%' || v_search || '%')))
    )
    union all
    (
      select e.id, 'pj'::text as type, e.legal_name as name, e.cnpj as doc,
        e.email_general as email, coalesce(e.whatsapp, e.phone) as phone,
        e.city, e.state_uf as uf, e.registration_status as status, e.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id in (select unit_id from public.legal_entity_units leu where leu.legal_entity_id = e.id)) as unit_names,
        (e.cnpj is not null and e.city is not null and e.state_uf is not null and (e.email_general is not null or e.phone is not null)) as complete,
        '{}'::text[] as kinds,
        e.trade_name, e.origin, e.tax_regime, e.state_registration, e.email_finance
      from public.legal_entities e
      where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
        and (p_unit is null or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any(u)))
        and (p_status is null or e.registration_status = p_status)
        and (v_search is null or e.legal_name ilike '%' || v_search || '%' or e.trade_name ilike '%' || v_search || '%'
             or (regexp_replace(v_search, '\D', '', 'g') <> '' and e.cnpj like '%' || regexp_replace(v_search, '\D', '', 'g') || '%')
             or e.email_general ilike '%' || v_search || '%')
    )
  ), filtered as (
    select * from base where (p_type is null or type = p_type) and (not p_incomplete_only or not complete)
  ), counted as (
    select *, count(*) over() as total_count from filtered
    order by
      case when v_sort = 'name' and v_dir = 'asc' then name end asc,
      case when v_sort = 'name' and v_dir = 'desc' then name end desc,
      case when v_sort = 'city' and v_dir = 'asc' then city end asc,
      case when v_sort = 'city' and v_dir = 'desc' then city end desc,
      case when v_sort = 'created_at' and v_dir = 'asc' then created_at end asc,
      case when v_sort = 'created_at' and v_dir = 'desc' then created_at end desc,
      id
    limit v_page_size offset (v_page * v_page_size)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'type', type, 'name', name,
      'document', case when v_full then doc else private.mask_document(doc) end,
      'document_full_available', v_full,
      'email', email, 'phone', phone, 'city', city, 'uf', uf, 'status', status, 'created_at', created_at,
      'units', coalesce(unit_names, '{}'), 'complete', complete, 'kinds', kinds,
      'trade_name', trade_name, 'origin', origin,
      'tax_regime', case when v_full then tax_regime end,
      'state_registration', case when v_full then state_registration end,
      'email_finance', case when v_full then email_finance end
    )), '[]'), coalesce(max(total_count), 0)
    into v_rows, v_total from counted;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_page_size);
end $$;

-- ---------------------------------------------------------------- exportação com permissão de campo (servidor)
-- Reaproveita adm_directory (mesmos filtros e mesma máscara) e ainda restringe as colunas pedidas às permitidas.
create or replace function public.adm_export(
  p_search text default null, p_type text default null, p_kind public.person_kind default null,
  p_unit uuid default null, p_status text default null, p_incomplete_only boolean default false,
  p_columns text[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_full boolean := private.can_adm_sensitive(); v_cols text[]; v_acc jsonb := '[]'::jsonb; v_page int := 0; v_res jsonb; v_total bigint;
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(array_agg(t.k order by t.ord), '{}') into v_cols
    from unnest(coalesce(p_columns, (select array_agg(key order by pos) from private.adm_column_catalog() where default_visible))) with ordinality t(k, ord)
    join private.adm_column_catalog() c on c.key = t.k and ((not c.sensitive) or v_full);
  loop
    v_res := public.adm_directory(p_search, p_type, p_kind, p_unit, p_status, p_incomplete_only, 'name', 'asc', v_page, 100);
    v_total := (v_res->>'total')::bigint;
    v_acc := v_acc || (select coalesce(jsonb_agg((select jsonb_object_agg(e.key, e.value) from jsonb_each(r) e where e.key = any (v_cols))), '[]')
                         from jsonb_array_elements(v_res->'rows') r);
    v_page := v_page + 1;
    exit when v_page * 100 >= v_total or v_page >= 50;      -- teto de 5.000 linhas por exportação
  end loop;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, new_values)
    values (private.current_org(), (select auth.uid()), 'adm_export', 'adm_directory', null, p_unit,
            jsonb_build_object('rows', jsonb_array_length(v_acc), 'total_matching', v_total, 'columns', to_jsonb(v_cols), 'masked_document', not v_full));
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_acc, 'total', v_total, 'truncated', v_total > 5000, 'masked_document', not v_full);
end $$;

-- ---------------------------------------------------------------- importação CSV de pessoas jurídicas
create table public.adm_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('pj')),
  file_name text,
  unit_id uuid references public.units(id) on delete set null,
  totals jsonb not null default '{}',
  report jsonb not null default '[]',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.adm_import_batches enable row level security;
grant select on public.adm_import_batches to authenticated;
create policy adm_import_batches_read on public.adm_import_batches for select to authenticated
  using (private.in_org(org_id) and private.can_adm_sensitive());

-- campos importáveis (chave do CSV mapeado → coluna de legal_entities). CNPJ e razão social são obrigatórios.
create or replace function private.pj_import_fields() returns table (key text, label text)
language sql immutable set search_path = '' as $$
  values ('legal_name'::text,'Razão social'::text), ('trade_name','Nome fantasia'), ('email_general','E-mail'), ('phone','Telefone'),
         ('city','Cidade'), ('state_uf','UF'), ('cep','CEP'), ('tax_regime','Regime tributário'),
         ('state_registration','Inscrição estadual'), ('municipal_registration','Inscrição municipal'), ('cnae_main','CNAE principal')
$$;

-- normalização por campo (comparação e gravação usam a mesma regra → reimportar o mesmo arquivo dá "sem alteração")
create or replace function private.pj_norm(p_key text, p_val text) returns text
language sql immutable set search_path = '' as $$
  select nullif(case p_key
    when 'email_general' then lower(btrim(coalesce(p_val, '')))
    when 'phone' then regexp_replace(coalesce(p_val, ''), '\D', '', 'g')
    when 'cep' then regexp_replace(coalesce(p_val, ''), '\D', '', 'g')
    when 'state_uf' then upper(btrim(coalesce(p_val, '')))
    when 'cnae_main' then regexp_replace(coalesce(p_val, ''), '\D', '', 'g')
    else btrim(regexp_replace(coalesce(p_val, ''), '\s+', ' ', 'g'))
  end, '')
$$;

-- Análise (sem gravar): status por linha = new | unchanged | conflict | archived | invalid | duplicate_in_file
create or replace function private.pj_import_analyze(p_rows jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_org uuid := private.current_org(); r jsonb; idx int := 0; out jsonb := '[]'::jsonb; seen text[] := '{}';
  v_cnpj text; v_msgs text[]; e public.legal_entities; v_diffs jsonb; f record; v_in text; v_cur text; v_entity jsonb; v_status text;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Formato de linhas inválido'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Limite de 500 linhas por importação'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1; v_msgs := '{}'; v_diffs := '[]'::jsonb; v_status := 'new'; e := null;
    v_cnpj := nullif(regexp_replace(coalesce(r->>'cnpj', ''), '\D', '', 'g'), '');
    if v_cnpj is null then v_msgs := array_append(v_msgs, 'CNPJ ausente'::text); end if;
    if v_cnpj is not null and not private.is_valid_cnpj(v_cnpj) then v_msgs := array_append(v_msgs, 'CNPJ com dígito verificador inválido: ' || coalesce(r->>'cnpj', '')); end if;
    if length(coalesce(private.pj_norm('legal_name', r->>'legal_name'), '')) < 2 then v_msgs := array_append(v_msgs, 'Razão social ausente ou muito curta'::text); end if;
    if private.pj_norm('email_general', r->>'email_general') is not null and private.pj_norm('email_general', r->>'email_general') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_msgs := array_append(v_msgs, 'E-mail inválido: ' || (r->>'email_general')); end if;
    if private.pj_norm('state_uf', r->>'state_uf') is not null and private.pj_norm('state_uf', r->>'state_uf') !~ '^[A-Z]{2}$' then v_msgs := array_append(v_msgs, 'UF inválida: ' || (r->>'state_uf')); end if;
    if private.pj_norm('cep', r->>'cep') is not null and length(private.pj_norm('cep', r->>'cep')) <> 8 then v_msgs := array_append(v_msgs, 'CEP inválido: ' || (r->>'cep')); end if;
    if private.pj_norm('phone', r->>'phone') is not null and length(private.pj_norm('phone', r->>'phone')) not between 10 and 13 then v_msgs := array_append(v_msgs, 'Telefone inválido: ' || (r->>'phone')); end if;

    if array_length(v_msgs, 1) is not null then
      v_status := 'invalid';
    elsif v_cnpj = any (seen) then
      v_status := 'duplicate_in_file'; v_msgs := array_append(v_msgs, 'CNPJ repetido no arquivo: só a primeira ocorrência é considerada'::text);
    else
      seen := seen || v_cnpj;
      select * into e from public.legal_entities where org_id = v_org and cnpj = v_cnpj and merged_into_id is null;
      if found then
        if e.archived_at is not null then
          v_status := 'archived'; v_msgs := array_append(v_msgs, 'Cadastro existente está arquivado: restaure-o antes de reimportar'::text);
        else
          v_entity := to_jsonb(e);
          for f in select * from private.pj_import_fields() loop
            v_in := private.pj_norm(f.key, r->>f.key);
            v_cur := private.pj_norm(f.key, v_entity->>f.key);
            if v_in is not null and v_in is distinct from v_cur then
              v_diffs := v_diffs || jsonb_build_object('field', f.key, 'label', f.label, 'current', v_cur, 'incoming', v_in,
                                                       'kind', case when v_cur is null then 'fill' else 'overwrite' end);
            end if;
          end loop;
          v_status := case when jsonb_array_length(v_diffs) = 0 then 'unchanged' else 'conflict' end;
        end if;
      end if;
    end if;
    out := out || jsonb_build_object('idx', idx - 1, 'line', coalesce((r->>'line')::int, idx + 1), 'cnpj', v_cnpj, 'legal_name', r->>'legal_name',
             'status', v_status, 'messages', to_jsonb(v_msgs), 'existing_id', e.id, 'existing_name', e.legal_name, 'diffs', v_diffs);
  end loop;
  return out;
end $$;

create or replace function public.legal_entity_import_check(p_rows jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.can_adm_sensitive() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.pj_import_analyze(p_rows);
end $$;

-- gravação de lote e auditoria por função definer (o papel autenticado não tem INSERT direto nessas tabelas);
-- só é chamada a partir de RPCs que já checaram private.can_adm_sensitive().
create or replace function private.adm_record_audit(p_action text, p_entity_type text, p_entity_id text, p_unit uuid, p_cols text[], p_old jsonb, p_new jsonb) returns void
language sql security definer set search_path = '' as $h$
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns, old_values, new_values)
  values (private.current_org(), (select auth.uid()), p_action, p_entity_type, p_entity_id, p_unit, p_cols, p_old, p_new)
$h$;
create or replace function private.adm_record_batch(p_kind text, p_file text, p_unit uuid, p_totals jsonb, p_report jsonb) returns uuid
language plpgsql security definer set search_path = '' as $h$
declare v_id uuid;
begin
  insert into public.adm_import_batches (org_id, kind, file_name, unit_id, totals, report, created_by)
    values (private.current_org(), p_kind, left(p_file, 200), p_unit, p_totals, p_report, (select auth.uid())) returning id into v_id;
  return v_id;
end $h$;

-- Gravação. Recalcula a análise no servidor (nunca confia no status enviado pelo cliente).
--  · new  → cria; · unchanged → nada; · conflict → só atualiza se houver decisão explícita {idx, action:'update', fields:[...]},
--    e só os campos escolhidos; sem decisão, o cadastro existente fica intacto e a linha entra no relatório como "ignorada".
create or replace function public.legal_entity_import_commit(p_rows jsonb, p_unit uuid, p_decisions jsonb default '[]', p_file_name text default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid := private.current_org(); a jsonb; rows_ jsonb; rep jsonb := '[]'::jsonb; idx int; st text; src jsonb; dec jsonb; v_id uuid;
  v_fields text[]; f text; v_old jsonb; v_new jsonb; n_created int := 0; n_updated int := 0; n_unchanged int := 0; n_skipped int := 0; n_invalid int := 0;
  v_outcome text; v_msg text; v_batch uuid; sets text;
begin
  if not private.can_adm_sensitive() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_unit is null or not exists (select 1 from public.units where id = p_unit and org_id = v_org) then raise exception 'Selecione a unidade de destino'; end if;
  rows_ := private.pj_import_analyze(p_rows);
  for a in select * from jsonb_array_elements(rows_) loop
    idx := (a->>'idx')::int; st := a->>'status'; src := p_rows -> idx; v_msg := null; v_id := null;
    if st = 'new' then
      begin
        insert into public.legal_entities (org_id, cnpj, legal_name, trade_name, email_general, phone, city, state_uf, cep, tax_regime,
            state_registration, municipal_registration, cnae_main, origin, created_by)
          values (v_org, a->>'cnpj', private.pj_norm('legal_name', src->>'legal_name'), private.pj_norm('trade_name', src->>'trade_name'),
            private.pj_norm('email_general', src->>'email_general'), private.pj_norm('phone', src->>'phone'), private.pj_norm('city', src->>'city'),
            private.pj_norm('state_uf', src->>'state_uf'), private.pj_norm('cep', src->>'cep'), private.pj_norm('tax_regime', src->>'tax_regime'),
            private.pj_norm('state_registration', src->>'state_registration'), private.pj_norm('municipal_registration', src->>'municipal_registration'),
            private.pj_norm('cnae_main', src->>'cnae_main'), 'importacao_csv', (select auth.uid()))
          returning id into v_id;
        insert into public.legal_entity_units (legal_entity_id, unit_id) values (v_id, p_unit);
        v_outcome := 'created'; n_created := n_created + 1;
      exception when unique_violation then
        v_outcome := 'skipped'; v_msg := 'CNPJ já cadastrado por outra operação concorrente'; n_skipped := n_skipped + 1;
      end;
    elsif st = 'unchanged' then
      v_outcome := 'unchanged'; v_msg := 'Cadastro existente já contém estes dados'; n_unchanged := n_unchanged + 1;
    elsif st = 'conflict' then
      select d into dec from jsonb_array_elements(coalesce(p_decisions, '[]')) d where (d->>'idx')::int = idx limit 1;
      if dec is not null and dec->>'action' = 'update' then
        v_fields := array(select x from jsonb_array_elements_text(coalesce(dec->'fields', '[]')) x
                          where x in (select jsonb_array_elements_text(coalesce((select jsonb_agg(df->>'field') from jsonb_array_elements(a->'diffs') df), '[]'))));
        if coalesce(array_length(v_fields, 1), 0) = 0 then
          v_outcome := 'skipped'; v_msg := 'Nenhum campo selecionado para atualizar'; n_skipped := n_skipped + 1;
        else
          v_id := (a->>'existing_id')::uuid; v_old := '{}'; v_new := '{}';
          foreach f in array v_fields loop
            v_old := v_old || jsonb_build_object(f, (select df->>'current' from jsonb_array_elements(a->'diffs') df where df->>'field' = f));
            v_new := v_new || jsonb_build_object(f, (select df->>'incoming' from jsonb_array_elements(a->'diffs') df where df->>'field' = f));
          end loop;
          -- colunas vêm de lista fixa (private.pj_import_fields) — sem SQL dinâmico com texto do usuário
          update public.legal_entities set
            legal_name = case when 'legal_name' = any (v_fields) then v_new->>'legal_name' else legal_name end,
            trade_name = case when 'trade_name' = any (v_fields) then v_new->>'trade_name' else trade_name end,
            email_general = case when 'email_general' = any (v_fields) then v_new->>'email_general' else email_general end,
            phone = case when 'phone' = any (v_fields) then v_new->>'phone' else phone end,
            city = case when 'city' = any (v_fields) then v_new->>'city' else city end,
            state_uf = case when 'state_uf' = any (v_fields) then v_new->>'state_uf' else state_uf end,
            cep = case when 'cep' = any (v_fields) then v_new->>'cep' else cep end,
            tax_regime = case when 'tax_regime' = any (v_fields) then v_new->>'tax_regime' else tax_regime end,
            state_registration = case when 'state_registration' = any (v_fields) then v_new->>'state_registration' else state_registration end,
            municipal_registration = case when 'municipal_registration' = any (v_fields) then v_new->>'municipal_registration' else municipal_registration end,
            cnae_main = case when 'cnae_main' = any (v_fields) then v_new->>'cnae_main' else cnae_main end
          where id = v_id and org_id = v_org;
          insert into public.legal_entity_units (legal_entity_id, unit_id) values (v_id, p_unit) on conflict do nothing;
          perform private.adm_record_audit('adm_import_update', 'legal_entities', v_id::text, p_unit, v_fields, v_old, v_new);
          v_outcome := 'updated'; v_msg := 'Campos atualizados por decisão explícita: ' || array_to_string(v_fields, ', '); n_updated := n_updated + 1;
        end if;
      else
        v_outcome := 'skipped'; v_msg := 'CNPJ já cadastrado com dados diferentes — mantido como está (sem decisão de atualizar)'; n_skipped := n_skipped + 1;
        v_id := (a->>'existing_id')::uuid;
      end if;
    elsif st = 'duplicate_in_file' then
      v_outcome := 'skipped'; v_msg := (a->'messages'->>0); n_skipped := n_skipped + 1;
    else
      v_outcome := 'invalid'; v_msg := array_to_string(array(select jsonb_array_elements_text(a->'messages')), '; '); n_invalid := n_invalid + 1;
    end if;
    rep := rep || jsonb_build_object('idx', idx, 'line', a->'line', 'cnpj', a->'cnpj', 'legal_name', a->'legal_name', 'outcome', v_outcome, 'message', v_msg, 'entity_id', v_id);
  end loop;

  v_batch := private.adm_record_batch('pj', p_file_name, p_unit,
            jsonb_build_object('created', n_created, 'updated', n_updated, 'unchanged', n_unchanged, 'skipped', n_skipped, 'invalid', n_invalid, 'rows', jsonb_array_length(rows_)), rep);
  perform private.adm_record_audit('adm_import_pj', 'adm_import_batches', v_batch::text, p_unit, null, null,
            jsonb_build_object('created', n_created, 'updated', n_updated, 'unchanged', n_unchanged, 'skipped', n_skipped, 'invalid', n_invalid));
  return jsonb_build_object('batch_id', v_batch, 'totals', jsonb_build_object('created', n_created, 'updated', n_updated, 'unchanged', n_unchanged, 'skipped', n_skipped, 'invalid', n_invalid), 'report', rep);
end $$;

grant execute on function public.adm_columns_catalog(), public.adm_view_get(text), public.adm_view_save(text[], text), public.adm_view_reset(text),
  public.adm_export(text, text, public.person_kind, uuid, text, boolean, text[]),
  public.legal_entity_import_check(jsonb), public.legal_entity_import_commit(jsonb, uuid, jsonb, text) to authenticated;
grant execute on function private.adm_record_audit(text, text, text, uuid, text[], jsonb, jsonb), private.adm_record_batch(text, text, uuid, jsonb, jsonb) to authenticated;
grant execute on function private.adm_column_catalog(), private.pj_import_fields(), private.pj_norm(text, text), private.pj_import_analyze(jsonb) to authenticated;
