-- Importação CSV do CRM (leads + oportunidades) com validação, deduplicação no SERVIDOR e decisão explícita de conflitos.
-- A tela mapeia colunas, mostra a prévia e envia linhas já normalizadas; nada é gravado antes da confirmação e NENHUM dado existente é sobrescrito sem decisão.
-- Reimportar o mesmo arquivo não duplica pessoas nem oportunidades: pessoa existente (mesmo contato) é reaproveitada e oportunidade ABERTA do mesmo funil não é recriada.
--
-- Contrato das linhas (jsonb, máx. 500): { name, email, phone, source, campaign, unit, owner, list, stage, value, title } — só name + (email ou phone) são obrigatórios.
-- Padrões do lote (p_defaults): { unit_id, pipeline_id, stage_id, owner_user_id, list_id, source, campaign } — a coluna da linha, quando preenchida, vale mais que o padrão.
-- Decisões por linha (p_decisions, chave = índice da linha): { action: 'skip' | 'use_existing' | 'update_existing' | 'create_new', person_id?, fields?: ['name','phone','email'] }.
-- Linha em conflito SEM decisão fica 'pending' (não é gravada).

create table public.crm_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete set null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  filename text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  row_count int not null, summary jsonb not null default '{}'
);
alter table public.crm_imports enable row level security;
grant select on public.crm_imports to authenticated;
create policy crm_imports_read on public.crm_imports for select to authenticated
  using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create trigger audit_crm_imports after insert on public.crm_imports for each row execute function private.audit_row('filename','row_count');

-- ---------------------------------------------------------------- análise de UMA linha (mesma regra para a prévia e para a gravação)
create or replace function private.crm_import_analyze(p_row jsonb, p_def jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); v_roles public.app_role[] := array['manager','ops_admin','unit_manager','sales']::public.app_role[];
  v_name text := btrim(coalesce(p_row ->> 'name', '')); v_email text := lower(nullif(btrim(coalesce(p_row ->> 'email', '')), '')); v_phone text := nullif(btrim(coalesce(p_row ->> 'phone', '')), '');
  errs text[] := '{}'; v_unit uuid; v_stage uuid; v_owner uuid; v_list uuid; v_val bigint := 0; v_src text; v_camp text; v_title text; v_pipe uuid := nullif(p_def ->> 'pipeline_id', '')::uuid;
  t text; d record; v_cands jsonb := '[]'; v_strong uuid[] := '{}'; v_weak uuid[] := '{}'; v_invisible boolean := false; v_person uuid; v_diffs jsonb := '[]'; v_status text := 'new'; v_kind text;
  v_has_opp boolean := false; v_exist_name text;
begin
  if length(v_name) < 2 then errs := array_append(errs, 'nome obrigatório (mínimo de 2 caracteres)'); end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then errs := array_append(errs, 'e-mail inválido'); end if;
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 13 then errs := array_append(errs, 'telefone inválido (use DDD + número)'); end if;
  if v_email is null and v_phone is null then errs := array_append(errs, 'informe e-mail ou telefone'); end if;

  if v_pipe is null or not exists (select 1 from public.pipelines where id = v_pipe and org_id = v_org and active) then errs := array_append(errs, 'funil inválido'); v_pipe := null; end if;

  t := nullif(btrim(coalesce(p_row ->> 'unit', '')), '');
  if t is not null then
    select id into v_unit from public.units where org_id = v_org and active and (lower(name) = lower(t) or lower(slug) = lower(t)) limit 1;
    if v_unit is null then errs := array_append(errs, format('unidade "%s" não encontrada', t)); end if;
  else
    v_unit := nullif(p_def ->> 'unit_id', '')::uuid;
    if v_unit is null then errs := array_append(errs, 'informe a unidade'); elsif not exists (select 1 from public.units where id = v_unit and org_id = v_org and active) then errs := array_append(errs, 'unidade inválida'); v_unit := null; end if;
  end if;
  if v_unit is not null and not private.has_unit_role(v_roles, v_unit) then errs := array_append(errs, 'sem permissão para importar nesta unidade'); v_unit := null; end if;

  if v_pipe is not null then
    t := nullif(btrim(coalesce(p_row ->> 'stage', '')), '');
    if t is not null then
      select id into v_stage from public.pipeline_stages where pipeline_id = v_pipe and kind = 'open' and lower(name) = lower(t);
      if v_stage is null then errs := array_append(errs, format('etapa "%s" não existe neste funil (ou não é uma etapa aberta)', t)); end if;
    else
      v_stage := nullif(p_def ->> 'stage_id', '')::uuid;
      if v_stage is not null and not exists (select 1 from public.pipeline_stages where id = v_stage and pipeline_id = v_pipe and kind = 'open') then errs := array_append(errs, 'etapa inicial inválida para este funil'); v_stage := null; end if;
      if v_stage is null and cardinality(errs) = 0 then select id into v_stage from public.pipeline_stages where pipeline_id = v_pipe and kind = 'open' order by position limit 1; end if;
    end if;
  end if;

  t := lower(nullif(btrim(coalesce(p_row ->> 'owner', '')), ''));
  if t is not null then
    select ua.user_id into v_owner from public.user_accounts ua join auth.users u on u.id = ua.user_id
     where ua.org_id = v_org and ua.status = 'active' and lower(u.email) = t
       and exists (select 1 from public.role_assignments ra where ra.user_id = ua.user_id and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
                      and ra.role = any (v_roles) and (ra.unit_id is null or v_unit is null or ra.unit_id = v_unit));
    if v_owner is null then errs := array_append(errs, format('responsável "%s" não encontrado ou sem papel comercial nesta unidade', t)); end if;
  elsif nullif(p_def ->> 'owner_user_id', '') is not null then
    v_owner := (p_def ->> 'owner_user_id')::uuid;
    if not exists (select 1 from public.user_accounts ua where ua.user_id = v_owner and ua.org_id = v_org and ua.status = 'active'
                      and exists (select 1 from public.role_assignments ra where ra.user_id = ua.user_id and ra.revoked_at is null and ra.role = any (v_roles) and (ra.unit_id is null or v_unit is null or ra.unit_id = v_unit))) then
      errs := array_append(errs, 'responsável padrão inválido para esta unidade'); v_owner := null;
    end if;
  end if;

  t := nullif(btrim(coalesce(p_row ->> 'list', '')), '');
  if t is not null then
    select id into v_list from public.crm_lead_lists where org_id = v_org and lower(name) = lower(t);
    if v_list is null then errs := array_append(errs, format('lista "%s" não encontrada (crie a lista antes de importar)', t)); end if;
  elsif nullif(p_def ->> 'list_id', '') is not null then
    v_list := (p_def ->> 'list_id')::uuid;
    if not exists (select 1 from public.crm_lead_lists where id = v_list and org_id = v_org) then errs := array_append(errs, 'lista padrão inválida'); v_list := null; end if;
  end if;

  v_src := coalesce(nullif(btrim(coalesce(p_row ->> 'source', '')), ''), nullif(btrim(coalesce(p_def ->> 'source', '')), ''), 'Importação CSV');
  v_camp := coalesce(nullif(btrim(coalesce(p_row ->> 'campaign', '')), ''), nullif(btrim(coalesce(p_def ->> 'campaign', '')), ''));
  v_title := coalesce(nullif(btrim(coalesce(p_row ->> 'title', '')), ''), v_name);
  t := nullif(btrim(coalesce(p_row ->> 'value', '')), '');
  if t is not null then
    t := regexp_replace(t, '[R$\s]', '', 'g');
    t := case when t ~ ',\d{1,2}$' then replace(replace(t, '.', ''), ',', '.') else replace(t, ',', '') end;
    if t !~ '^\d+(\.\d+)?$' or t::numeric > 10000000 then errs := array_append(errs, 'valor inválido'); else v_val := round(t::numeric * 100)::bigint; end if;
  end if;

  if cardinality(errs) > 0 then
    return jsonb_build_object('status', 'invalid', 'errors', to_jsonb(errs), 'name', v_name);
  end if;

  -- pessoa: o cadastro central é a fonte (find_person_duplicates respeita a visibilidade de cada pessoa)
  for d in select * from public.find_person_duplicates(v_name, array[v_email], array[v_phone]) loop
    v_cands := v_cands || jsonb_build_object('id', case when d.visible then d.person_id end, 'name', d.full_name, 'reason', d.match_reason, 'visible', d.visible);
    if not d.visible then v_invisible := true;
    elsif d.match_reason like '%contato_igual%' then v_strong := v_strong || d.person_id;
    else v_weak := v_weak || d.person_id; end if;
  end loop;

  if cardinality(v_strong) = 1 and not v_invisible then
    v_person := v_strong[1];
    select full_name into v_exist_name from public.people where id = v_person;
    if extensions.similarity(lower(btrim(v_exist_name)), lower(v_name)) < 0.9 then v_diffs := v_diffs || jsonb_build_object('field', 'name', 'existing', v_exist_name, 'incoming', v_name); end if;
    if v_phone is not null and not exists (select 1 from public.person_contacts c where c.person_id = v_person and c.type in ('phone','whatsapp') and c.normalized = private.norm_phone(v_phone)) then
      v_diffs := v_diffs || jsonb_build_object('field', 'phone', 'existing', (select string_agg(c.value, ', ') from public.person_contacts c where c.person_id = v_person and c.type in ('phone','whatsapp')), 'incoming', v_phone);
    end if;
    if v_email is not null and not exists (select 1 from public.person_contacts c where c.person_id = v_person and c.type = 'email' and c.normalized = v_email) then
      v_diffs := v_diffs || jsonb_build_object('field', 'email', 'existing', (select string_agg(c.value, ', ') from public.person_contacts c where c.person_id = v_person and c.type = 'email'), 'incoming', v_email);
    end if;
    v_has_opp := exists (select 1 from public.opportunities o where o.person_id = v_person and o.pipeline_id = v_pipe and o.status = 'open');
    if jsonb_array_length(v_diffs) > 0 then v_status := 'conflict'; v_kind := 'dados_divergentes';
    else v_status := case when v_has_opp then 'duplicate' else 'existing' end; end if;
  elsif cardinality(v_strong) + cardinality(v_weak) > 0 or v_invisible then
    v_status := 'conflict';
    v_kind := case when v_invisible then 'cadastro_em_outra_unidade' when cardinality(v_strong) > 1 then 'varias_pessoas' else 'homonimo_possivel' end;
  end if;

  return jsonb_build_object('status', v_status, 'errors', '[]'::jsonb, 'kind', v_kind, 'diffs', v_diffs, 'candidates', v_cands, 'person_id', v_person, 'existing_name', v_exist_name, 'has_open_opportunity', v_has_opp,
    'name', v_name, 'email', v_email, 'phone', v_phone, 'unit_id', v_unit, 'pipeline_id', v_pipe, 'stage_id', v_stage, 'owner_user_id', v_owner, 'list_id', v_list,
    'source', v_src, 'campaign', v_camp, 'title', v_title, 'value_cents', v_val);
end $$;

-- ---------------------------------------------------------------- prévia (não grava nada)
create or replace function public.crm_import_check(p_defaults jsonb, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i int := 0; x jsonb; a jsonb; out jsonb := '[]';
begin
  if private.current_org() is null or not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'envie até 500 linhas por lote'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    a := private.crm_import_analyze(x, coalesce(p_defaults, '{}'));
    out := out || (jsonb_build_object('idx', i) || (a - 'email' - 'phone'));
    i := i + 1;
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- gravação (linha a linha, cada uma isolada; erro numa linha não derruba as outras)
create or replace function public.crm_import_commit(p_defaults jsonb, p_rows jsonb, p_decisions jsonb default '{}', p_filename text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); v_roles public.app_role[] := array['manager','ops_admin','unit_manager','sales']::public.app_role[];
  i int := 0; x jsonb; a jsonb; dec jsonb; act text; v_person uuid; v_res jsonb; v_status text; v_msg text; out jsonb := '[]'; v_def jsonb := coalesce(p_defaults, '{}');
  v_unit uuid; v_owner uuid; f text; v_import uuid := gen_random_uuid(); v_created int := 0; v_linked int := 0; v_dup int := 0; v_err int := 0; v_pend int := 0; v_skip int := 0; v_updated int := 0; v_inv int := 0;
  v_p public.people; v_opp_made boolean; v_cand_ok boolean;
begin
  if v_org is null or not private.has_any_role(v_roles) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'envie até 500 linhas por lote'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_status := null; v_msg := null; v_person := null; v_opp_made := false;
    begin
      a := private.crm_import_analyze(x, v_def); dec := coalesce(p_decisions, '{}') -> i::text; act := dec ->> 'action';
      if a ->> 'status' = 'invalid' then v_status := 'invalid'; v_msg := (select string_agg(e, '; ') from jsonb_array_elements_text(a -> 'errors') e); v_inv := v_inv + 1;
      else
        v_unit := (a ->> 'unit_id')::uuid;
        if a ->> 'status' = 'conflict' then
          if act is null then v_status := 'pending'; v_pend := v_pend + 1;
          elsif act = 'skip' then v_status := 'skipped'; v_skip := v_skip + 1;
          elsif act = 'use_existing' then
            v_person := coalesce(nullif(dec ->> 'person_id', '')::uuid, (a ->> 'person_id')::uuid);
            select exists (select 1 from jsonb_array_elements(a -> 'candidates') c where (c ->> 'visible')::boolean and (c ->> 'id')::uuid = v_person) into v_cand_ok;
            if v_person is null or not v_cand_ok then raise exception 'escolha uma das pessoas candidatas visíveis'; end if;
          elsif act = 'update_existing' then
            v_person := (a ->> 'person_id')::uuid;
            if v_person is null or a ->> 'kind' <> 'dados_divergentes' then raise exception 'atualizar só se aplica a uma pessoa existente com dados divergentes'; end if;
            select * into v_p from public.people where id = v_person;
            if not private.has_unit_role(v_roles, v_p.unit_id) then raise exception 'sem permissão para alterar este cadastro'; end if;
            for f in select jsonb_array_elements_text(coalesce(dec -> 'fields', '[]')) loop
              if f not in ('name','phone','email') then raise exception 'campo inválido na decisão: %', f; end if;
              if not exists (select 1 from jsonb_array_elements(a -> 'diffs') d where d ->> 'field' = f) then raise exception 'o campo % não diverge', f; end if;
              if f = 'name' then update public.people set full_name = a ->> 'name' where id = v_person;
              elsif f = 'phone' then insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (v_org, v_person, 'phone', a ->> 'phone', not exists (select 1 from public.person_contacts where person_id = v_person and type in ('phone','whatsapp')), false) on conflict do nothing;
              else insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (v_org, v_person, 'email', a ->> 'email', not exists (select 1 from public.person_contacts where person_id = v_person and type = 'email'), false) on conflict do nothing;
              end if;
            end loop;
            v_status := 'updated';
          elsif act = 'create_new' then
            v_res := public.create_person(a ->> 'name', v_unit, array['lead']::public.person_kind[], a ->> 'email', a ->> 'phone', null, true);
            v_person := (v_res ->> 'id')::uuid; v_status := 'created';
          else raise exception 'decisão inválida'; end if;
        elsif a ->> 'status' = 'new' then
          v_res := public.create_person(a ->> 'name', v_unit, array['lead']::public.person_kind[], a ->> 'email', a ->> 'phone', null, true);
          v_person := (v_res ->> 'id')::uuid; v_status := 'created';
        else v_person := (a ->> 'person_id')::uuid; end if;      -- existing | duplicate

        if v_status is null or v_status in ('created','updated') then
          if v_person is not null then
            if not exists (select 1 from public.opportunities o where o.person_id = v_person and o.pipeline_id = (a ->> 'pipeline_id')::uuid and o.status = 'open') then
              v_owner := coalesce((a ->> 'owner_user_id')::uuid, private.pick_owner(v_org, v_unit), (select auth.uid()));
              insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, value_cents, source, campaign, created_by)
                values (v_org, v_unit, v_person, (a ->> 'pipeline_id')::uuid, (a ->> 'stage_id')::uuid, v_owner, a ->> 'title', (a ->> 'value_cents')::bigint, a ->> 'source', a ->> 'campaign', (select auth.uid()));
              v_opp_made := true;
            end if;
            if nullif(a ->> 'list_id', '') is not null then
              insert into public.crm_lead_list_members (list_id, person_id, added_by) values ((a ->> 'list_id')::uuid, v_person, (select auth.uid())) on conflict do nothing;
            end if;
            if v_status is null then v_status := case when v_opp_made then 'linked' else 'duplicate' end; end if;
            if v_status = 'created' then v_created := v_created + 1; elsif v_status = 'updated' then v_updated := v_updated + 1; elsif v_status = 'linked' then v_linked := v_linked + 1; else v_dup := v_dup + 1; end if;
          end if;
        end if;
      end if;
    exception when others then
      v_status := 'error'; v_msg := sqlerrm; v_err := v_err + 1; v_person := null;
    end;
    out := out || jsonb_build_object('idx', i, 'status', v_status, 'person_id', v_person, 'opportunity_created', v_opp_made, 'message', v_msg);
    i := i + 1;
  end loop;
  insert into public.crm_imports (id, org_id, unit_id, pipeline_id, filename, created_by, row_count, summary)
    values (v_import, v_org, nullif(v_def ->> 'unit_id', '')::uuid, nullif(v_def ->> 'pipeline_id', '')::uuid, nullif(left(btrim(coalesce(p_filename, '')), 200), ''), (select auth.uid()), i,
            jsonb_build_object('created', v_created, 'linked', v_linked, 'updated', v_updated, 'duplicate', v_dup, 'skipped', v_skip, 'pending', v_pend, 'invalid', v_inv, 'error', v_err));
  return jsonb_build_object('import_id', v_import, 'results', out, 'summary', jsonb_build_object('created', v_created, 'linked', v_linked, 'updated', v_updated, 'duplicate', v_dup, 'skipped', v_skip, 'pending', v_pend, 'invalid', v_inv, 'error', v_err));
end $$;

revoke all on function private.crm_import_analyze(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.crm_import_check(jsonb, jsonb), public.crm_import_commit(jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.crm_import_check(jsonb, jsonb), public.crm_import_commit(jsonb, jsonb, jsonb, text) to authenticated;
