-- HP Group Hub — 050 App Contábil: RPCs (todas SECURITY DEFINER com checagem explícita de papel/unidade/concessão;
-- o navegador nunca escreve nas tabelas acc_* diretamente). Ver 049 para os princípios.

-- ajustes sobre o 049: alteração aceita vale só para o fechamento (close_seq) em que foi aceita; exportação com "ambas as bases"
alter table public.acc_change_reviews add column if not exists close_seq int not null default 0;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.acc_change_reviews'::regclass and contype = 'u' loop
    execute format('alter table public.acc_change_reviews drop constraint %I', c.conname);
  end loop;
end $$;
create unique index if not exists acc_change_reviews_uq on public.acc_change_reviews (period_id, close_seq, source_type, source_id, basis, fingerprint);
alter table public.acc_exports drop constraint if exists acc_exports_basis_check;
alter table public.acc_exports add constraint acc_exports_basis_check check (basis in ('competencia','caixa','ambas'));

create or replace function private.acc_changes(p_org uuid, p_unit uuid, p_month date)
returns table (source_type text, source_id uuid, basis text, change_type text, snapshot_cents bigint, current_cents bigint, description text, counterparty text, fingerprint text)
language sql stable security definer set search_path = '' as $$
with per as (
  select * from public.acc_periods p where p.org_id = p_org and p.unit_id = p_unit and p.competence_month = date_trunc('month', p_month)::date and p.status = 'closed'
),
cur as (
  select l.source_type, l.source_id, l.basis, l.signed_cents, l.description, l.counterparty, l.fingerprint from private.acc_ledger(p_org, p_unit, p_month, 'competencia', false) l
  union all
  select l.source_type, l.source_id, l.basis, l.signed_cents, l.description, l.counterparty, l.fingerprint from private.acc_ledger(p_org, p_unit, p_month, 'caixa', false) l
),
snap as (
  select s.* from public.acc_period_snapshot s join per on per.id = s.period_id and s.close_seq = per.close_seq
),
j as (
  select coalesce(cur.source_type, snap.source_type) st, coalesce(cur.source_id, snap.source_id) sid, coalesce(cur.basis, snap.basis) b,
    (case when snap.source_id is null then 'added' when cur.source_id is null then 'removed' else 'changed' end) ct,
    snap.amount_cents sc, cur.signed_cents cc, coalesce(cur.description, snap.description) d, coalesce(cur.counterparty, snap.counterparty) cp,
    coalesce(cur.fingerprint, 'removed') fp
  from cur full join snap on cur.source_type = snap.source_type and cur.source_id = snap.source_id and cur.basis = snap.basis
  where snap.source_id is null or cur.source_id is null or cur.fingerprint <> snap.fingerprint
)
select j.st, j.sid, j.b, j.ct, j.sc, j.cc, j.d, j.cp, j.fp from j cross join per
where not exists (select 1 from public.acc_change_reviews r where r.period_id = per.id and r.close_seq = per.close_seq
                    and r.source_type = j.st and r.source_id = j.sid and r.basis = j.b and r.fingerprint = j.fp)
$$;

-- ---------------------------------------------------------------- helpers
create or replace function private.acc_check(p_unit uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null or not private.can_acc(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.units where id = p_unit and org_id = v_org) then raise exception 'Unidade inválida'; end if;
  return v_org;
end $$;

create or replace function private.acc_month(p_month date) returns date
language sql immutable set search_path = '' as $$
  select case when p_month is null then null else date_trunc('month', p_month)::date end
$$;

create or replace function private.acc_is_closed(p_org uuid, p_unit uuid, p_month date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.acc_periods where org_id = p_org and unit_id = p_unit and competence_month = date_trunc('month', p_month)::date and status = 'closed')
$$;

create or replace function private.acc_period_ensure(p_org uuid, p_unit uuid, p_month date) returns public.acc_periods
language plpgsql security definer set search_path = '' as $$
declare per public.acc_periods;
begin
  insert into public.acc_periods (org_id, unit_id, competence_month) values (p_org, p_unit, date_trunc('month', p_month)::date) on conflict (unit_id, competence_month) do nothing;
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = date_trunc('month', p_month)::date;
  return per;
end $$;

create or replace function private.acc_settings_row(p_org uuid) returns public.acc_settings
language sql stable security definer set search_path = '' as $$
  select coalesce((select s from public.acc_settings s where s.org_id = p_org), row(p_org, true, 0, true, 10, null, now())::public.acc_settings)
$$;

create or replace function private.acc_local_month(p_unit uuid) returns date
language sql stable security definer set search_path = '' as $$
  select date_trunc('month', now() at time zone coalesce((select timezone from public.units where id = p_unit), 'America/Sao_Paulo'))::date
$$;

create or replace function private.acc_user_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(ua.display_name, ''), ua.email::text) from public.user_accounts ua where ua.user_id = p_user
$$;

-- mês de competência de um lançamento-fonte (para bloquear alteração em competência fechada)
create or replace function private.acc_source_month(p_org uuid, p_unit uuid, p_type text, p_id uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare v date;
begin
  if p_type = 'receivable' then select competence_month into v from public.receivables where id = p_id and org_id = p_org and unit_id = p_unit;
  elsif p_type = 'payable' then select competence_month into v from public.payables where id = p_id and org_id = p_org and unit_id = p_unit;
  elsif p_type = 'payment' then select r.competence_month into v from public.payments pm join public.receivables r on r.id = pm.receivable_id where pm.id = p_id and pm.org_id = p_org and pm.unit_id = p_unit;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- contexto (unidades, papéis, permissão específica)
create or replace function public.acc_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null or not private.can_acc_any() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object(
    'org', (select jsonb_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = v_org),
    'is_admin', private.can_acc_admin(),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'name', u.name, 'timezone', u.timezone,
        'legal_entity', (select jsonb_build_object('id', e.id, 'name', e.legal_name, 'cnpj', e.cnpj) from public.legal_entities e where e.id = u.legal_entity_id and private.can_adm()),
        'can_close', private.has_acc_grant('close', u.id), 'can_reopen', private.has_acc_grant('reopen', u.id),
        'can_see_names', private.can_acc_see_names(u.id)) order by u.name)
      from public.units u where u.org_id = v_org and u.active and private.can_acc(u.id)), '[]'::jsonb),
    'current_month', (select private.acc_local_month(u.id) from public.units u where u.org_id = v_org and u.active and private.can_acc(u.id) order by u.name limit 1));
end $$;

-- ---------------------------------------------------------------- dashboard
create or replace function public.acc_dashboard(p_unit uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); per public.acc_periods; v_cur date := private.acc_local_month(p_unit); v_over date[];
begin
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m;
  select array_agg(m order by m) into v_over from (
    select competence_month m from public.receivables where org_id = v_org and unit_id = p_unit and status <> 'cancelled'
    union select competence_month from public.payables where org_id = v_org and unit_id = p_unit and status <> 'cancelled'
  ) x where m < v_cur and m >= (v_cur - interval '12 months')::date
    and not exists (select 1 from public.acc_periods p where p.unit_id = p_unit and p.competence_month = x.m and p.status = 'closed');
  return jsonb_build_object(
    'month', v_m, 'current_month', v_cur, 'month_ended', v_m < v_cur,
    'period', jsonb_build_object('status', coalesce(per.status, 'open'), 'closed_at', per.closed_at, 'closed_by', private.acc_user_name(per.closed_by), 'close_seq', coalesce(per.close_seq, 0)),
    'metrics', private.acc_metrics(v_org, p_unit, v_m),
    'overdue_months', coalesce(to_jsonb(v_over), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- competências (visão de 13 meses)
create or replace function public.acc_periods_overview(p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_cur date := private.acc_local_month(p_unit); v_out jsonb := '[]'::jsonb; v_m date; per public.acc_periods; met jsonb; i int;
begin
  for i in 0..12 loop
    v_m := (v_cur - (i || ' months')::interval)::date;
    select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m;
    met := private.acc_metrics(v_org, p_unit, v_m);
    v_out := v_out || jsonb_build_object('month', v_m, 'status', coalesce(per.status, 'open'), 'in_progress', v_m >= v_cur,
      'closed_at', per.closed_at, 'closed_by', private.acc_user_name(per.closed_by), 'reopened_at', per.reopened_at, 'close_seq', coalesce(per.close_seq, 0), 'metrics', met,
      'has_data', (met->>'entries_comp')::int + (met->>'entries_cash')::int > 0);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- lançamentos e classificações
create or replace function public.acc_ledger_list(
  p_unit uuid, p_month date, p_basis text default 'competencia', p_kind text default null, p_filter text default 'all',
  p_search text default null, p_page int default 0, p_page_size int default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); v_names boolean := private.can_acc_see_names(p_unit);
  v_basis text := case when p_basis = 'caixa' then 'caixa' else 'competencia' end; v_size int := least(greatest(coalesce(p_page_size, 25), 1), 200);
  v_page int := greatest(coalesce(p_page, 0), 0); v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb; v_total bigint; v_sum jsonb; per public.acc_periods;
begin
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m;
  with chg as (
    select * from private.acc_changes(v_org, p_unit, v_m)
  ), l as (
    select x.*, exists (select 1 from chg ch where ch.source_type = x.source_type and ch.source_id = x.source_id and ch.basis = x.basis and ch.change_type <> 'removed') as changed
    from private.acc_ledger(v_org, p_unit, v_m, v_basis, v_names) x
  ), f as (
    select l.* from l
    where (p_kind is null or l.kind = p_kind)
      and (v_search is null or l.description ilike '%' || v_search || '%' or l.counterparty ilike '%' || v_search || '%' or coalesce(l.account_name, '') ilike '%' || v_search || '%')
      and (p_filter = 'all' or p_filter is null
           or (p_filter = 'unclassified' and not l.classified and not l.waived_class)
           or (p_filter = 'missing_receipt' and l.needs_receipt and l.doc_count = 0 and not l.waived_receipt)
           or (p_filter = 'changed' and l.changed))
  ), pg as (select f.*, count(*) over () as total_count from f order by f.entry_date, f.description, f.source_id limit v_size offset v_page * v_size)
  select coalesce(jsonb_agg(jsonb_build_object(
      'source_type', source_type, 'source_id', source_id, 'basis', basis, 'entry_date', entry_date, 'competence_month', competence_month, 'kind', kind,
      'description', description, 'counterparty', counterparty, 'amount_cents', amount_cents, 'signed_cents', signed_cents, 'status', row_status,
      'target_type', target_type, 'target_id', target_id, 'category_name', category_name,
      'account_id', account_id, 'account_name', account_name, 'suggested_account_id', suggested_account_id, 'suggested_account_name', suggested_account_name,
      'classified', classified, 'waived_class', waived_class, 'doc_count', doc_count, 'waived_receipt', waived_receipt,
      'missing_receipt', (needs_receipt and doc_count = 0 and not waived_receipt), 'changed', changed) order by entry_date, description, source_id), '[]'::jsonb),
    coalesce(max(total_count), 0) into v_rows, v_total from pg;
  select jsonb_build_object('count', count(*), 'income_cents', coalesce(sum(signed_cents) filter (where kind = 'income'), 0),
                            'expense_cents', coalesce(-sum(signed_cents) filter (where kind = 'expense'), 0))
    into v_sum from private.acc_ledger(v_org, p_unit, v_m, v_basis, false);
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'summary', v_sum, 'basis', v_basis,
                            'period_status', coalesce(per.status, 'open'), 'names_visible', v_names);
end $$;

-- ---------------------------------------------------------------- classificação
create or replace function public.acc_classify(p_unit uuid, p_items jsonb, p_account uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); it jsonb; v_type text; v_id uuid; v_month date; n_set int := 0; n_del int := 0; v_acc public.acc_accounts;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Selecione ao menos um lançamento'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Limite de 500 lançamentos por operação'; end if;
  if p_account is not null then
    select * into v_acc from public.acc_accounts where id = p_account and org_id = v_org and active;
    if not found then raise exception 'Classificação inexistente ou inativa'; end if;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_type := it->>'source_type'; v_id := (it->>'source_id')::uuid;
    if v_type not in ('receivable','payable') then raise exception 'Somente recebíveis e contas a pagar são classificados (pagamentos herdam do recebível)'; end if;
    v_month := private.acc_source_month(v_org, p_unit, v_type, v_id);
    if v_month is null then raise exception 'Lançamento não pertence a esta unidade'; end if;
    if private.acc_is_closed(v_org, p_unit, v_month) then raise exception 'A competência % está fechada: reabra-a (com permissão e justificativa) para alterar a classificação', to_char(v_month, 'MM/YYYY'); end if;
    if p_account is null then
      delete from public.acc_classifications where source_type = v_type and source_id = v_id and org_id = v_org; n_del := n_del + 1;
    else
      insert into public.acc_classifications (org_id, unit_id, source_type, source_id, account_id, note, classified_by)
        values (v_org, p_unit, v_type, v_id, p_account, nullif(btrim(p_note), ''), (select auth.uid()))
        on conflict (source_type, source_id) do update set account_id = excluded.account_id, note = excluded.note, classified_by = excluded.classified_by, classified_at = now();
      n_set := n_set + 1;
    end if;
  end loop;
  return jsonb_build_object('classified', n_set, 'removed', n_del);
end $$;

create or replace function public.acc_apply_suggestions(p_unit uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); n int;
begin
  if private.acc_is_closed(v_org, p_unit, v_m) then raise exception 'A competência % está fechada', to_char(v_m, 'MM/YYYY'); end if;
  with ins as (
    insert into public.acc_classifications (org_id, unit_id, source_type, source_id, account_id, note, classified_by)
    select v_org, p_unit, 'payable', l.source_id, l.suggested_account_id, 'Sugestão pela categoria do Financeiro', (select auth.uid())
    from private.acc_ledger(v_org, p_unit, v_m, 'competencia', false) l
    where l.source_type = 'payable' and not l.classified and l.suggested_account_id is not null
    on conflict (source_type, source_id) do nothing returning 1)
  select count(*) into n from ins;
  return jsonb_build_object('applied', n);
end $$;

create or replace function public.acc_waive(p_unit uuid, p_source_type text, p_source_id uuid, p_kind text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_month date;
begin
  if p_kind not in ('classification','receipt') then raise exception 'Tipo de dispensa inválido'; end if;
  if p_kind = 'receipt' and p_source_type <> 'payable' then raise exception 'Comprovante só é exigido de contas a pagar'; end if;
  if p_source_type not in ('receivable','payable') then raise exception 'Tipo de lançamento inválido'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Informe a justificativa (mínimo de 5 caracteres)'; end if;
  v_month := private.acc_source_month(v_org, p_unit, p_source_type, p_source_id);
  if v_month is null then raise exception 'Lançamento não pertence a esta unidade'; end if;
  if private.acc_is_closed(v_org, p_unit, v_month) then raise exception 'A competência % está fechada', to_char(v_month, 'MM/YYYY'); end if;
  insert into public.acc_waivers (org_id, unit_id, source_type, source_id, waiver_kind, reason, created_by)
    values (v_org, p_unit, p_source_type, p_source_id, p_kind, btrim(p_reason), (select auth.uid()))
    on conflict (source_type, source_id, waiver_kind) do update set reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- pendências (calculadas, não armazenadas)
create or replace function public.acc_pendencies(p_unit uuid, p_month date, p_type text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); v_names boolean := private.can_acc_see_names(p_unit); v_rows jsonb;
begin
  with comp as (select * from private.acc_ledger(v_org, p_unit, v_m, 'competencia', v_names)),
  cash as (select * from private.acc_ledger(v_org, p_unit, v_m, 'caixa', v_names)),
  allr as (select * from comp union all select * from cash),
  p as (
    select 'unclassified'::text ptype, c.source_type, c.source_id, c.basis, c.entry_date, c.description, c.counterparty, c.signed_cents, 'Sem classificação contábil'::text detail
      from comp c where not c.classified and not c.waived_class
    union all
    (select distinct on (a.source_id) 'missing_receipt', a.source_type, a.source_id, a.basis, a.entry_date, a.description, a.counterparty, a.signed_cents, 'Despesa paga sem comprovante anexado'
      from allr a where a.needs_receipt and a.doc_count = 0 and not a.waived_receipt order by a.source_id, a.basis)
    union all
    select 'changed_after_close', ch.source_type, ch.source_id, ch.basis, null::date, ch.description, ch.counterparty, coalesce(ch.current_cents, ch.snapshot_cents),
      case ch.change_type when 'added' then 'Lançamento incluído no Financeiro depois do fechamento'
                          when 'removed' then 'Lançamento cancelado/removido do período depois do fechamento'
                          else 'Valor ou data alterados no Financeiro depois do fechamento (era ' || coalesce(ch.snapshot_cents::text, '—') || ' centavos)' end
      from private.acc_changes(v_org, p_unit, v_m) ch
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', ptype, 'source_type', source_type, 'source_id', source_id, 'basis', basis, 'entry_date', entry_date,
      'description', description, 'counterparty', counterparty, 'signed_cents', signed_cents, 'detail', detail) order by ptype, entry_date nulls last, description), '[]'::jsonb)
    into v_rows from p where p_type is null or p.ptype = p_type;
  return jsonb_build_object('rows', v_rows, 'period_status', coalesce((select status from public.acc_periods where unit_id = p_unit and competence_month = v_m), 'open'));
end $$;

-- ---------------------------------------------------------------- documentos
create or replace function public.acc_document_register(p_unit uuid, p_month date, p_source_type text, p_source_id uuid, p_kind text, p_title text, p_path text, p_mime text, p_size bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); v_id uuid; v_src_month date;
begin
  if p_source_type not in ('receivable','payable','payment','period') then raise exception 'Tipo de vínculo inválido'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Informe um título para o documento'; end if;
  if split_part(p_path, '/', 1) <> v_org::text or split_part(p_path, '/', 2) <> p_unit::text then raise exception 'Caminho do arquivo não pertence a esta organização/unidade'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'accounting-private' and o.name = p_path) then raise exception 'Arquivo não encontrado no armazenamento — envie novamente'; end if;
  if private.acc_is_closed(v_org, p_unit, v_m) then raise exception 'A competência % está fechada: reabra-a para anexar documentos', to_char(v_m, 'MM/YYYY'); end if;
  if p_source_type <> 'period' then
    v_src_month := private.acc_source_month(v_org, p_unit, p_source_type, p_source_id);
    if v_src_month is null then
      -- pagamento em caixa pode ser de recebível de outra competência: vale se o lançamento pertence à unidade
      raise exception 'Lançamento não pertence a esta unidade';
    end if;
  end if;
  insert into public.acc_documents (org_id, unit_id, competence_month, source_type, source_id, kind, title, storage_path, mime, size_bytes, uploaded_by)
    values (v_org, p_unit, v_m, p_source_type, case when p_source_type = 'period' then null else p_source_id end,
            coalesce(nullif(p_kind, ''), 'comprovante'), btrim(p_title), p_path, left(p_mime, 100), p_size, (select auth.uid()))
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.acc_document_list(p_unit uuid, p_month date, p_source_type text default null, p_source_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'title', d.title, 'source_type', d.source_type, 'source_id', d.source_id, 'mime', d.mime, 'size_bytes', d.size_bytes,
      'uploaded_at', d.uploaded_at, 'uploaded_by', private.acc_user_name(d.uploaded_by), 'competence_month', d.competence_month,
      'source_label', case d.source_type
          when 'payable' then (select py.description from public.payables py where py.id = d.source_id)
          when 'receivable' then (select coalesce(pr.name, 'Parcela ' || r.installment_no || '/' || r.installments_total) from public.receivables r left join public.products pr on pr.id = r.product_id where r.id = d.source_id)
          when 'payment' then (select 'Recebimento ' || to_char(pm.paid_at, 'DD/MM/YYYY') from public.payments pm where pm.id = d.source_id)
          else 'Documento da competência' end) order by d.uploaded_at desc)
    from public.acc_documents d
    where d.org_id = v_org and d.unit_id = p_unit and d.removed_at is null
      and ((p_source_type is null and d.competence_month = v_m) or (p_source_type is not null and d.source_type = p_source_type and d.source_id = p_source_id))), '[]'::jsonb);
end $$;

-- caminho do arquivo para gerar URL assinada — só depois de checar permissão, e sempre auditado
create or replace function public.acc_documents_access(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_out jsonb;
begin
  if v_org is null or not private.can_acc_any() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 300 then raise exception 'Informe de 1 a 300 documentos'; end if;
  if exists (select 1 from public.acc_documents d where d.id = any (p_ids) and (d.org_id <> v_org or not private.can_acc(d.unit_id))) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'path', d.storage_path, 'title', d.title, 'mime', d.mime, 'removed', d.removed_at is not null)), '[]'::jsonb) into v_out
    from public.acc_documents d where d.id = any (p_ids) and d.org_id = v_org;
  perform private.adm_record_audit('acc_document_access', 'acc_documents', array_to_string(p_ids, ','), null, null, null, jsonb_build_object('count', array_length(p_ids, 1)));
  return v_out;
end $$;

create or replace function public.acc_document_remove(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); d public.acc_documents;
begin
  select * into d from public.acc_documents where id = p_id and org_id = v_org;
  if not found or not private.can_acc(d.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if d.removed_at is not null then raise exception 'Documento já removido'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Informe o motivo da remoção (mínimo de 5 caracteres)'; end if;
  if private.acc_is_closed(v_org, d.unit_id, d.competence_month) then raise exception 'A competência % está fechada: reabra-a para remover documentos', to_char(d.competence_month, 'MM/YYYY'); end if;
  update public.acc_documents set removed_at = now(), removed_by = (select auth.uid()), removed_reason = btrim(p_reason) where id = p_id;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- fechamento
create or replace function public.acc_period_detail(p_unit uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); per public.acc_periods; met jsonb; cfg public.acc_settings := private.acc_settings_row(private.current_org());
  v_ended boolean := private.acc_month(p_month) < private.acc_local_month(p_unit); gates jsonb; v_status text; v_can_close boolean;
begin
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m;
  v_status := coalesce(per.status, 'open'); met := private.acc_metrics(v_org, p_unit, v_m);
  gates := jsonb_build_array(
    jsonb_build_object('key', 'month_ended', 'label', 'Competência encerrada (mês já terminou)', 'ok', v_ended, 'blocking', true, 'count', 0),
    jsonb_build_object('key', 'in_review', 'label', 'Competência revisada (status “Em revisão”)', 'ok', v_status in ('in_review','closed'), 'blocking', true, 'count', 0),
    jsonb_build_object('key', 'unclassified', 'label', 'Todos os lançamentos classificados (ou dispensados com justificativa)', 'ok', (met->>'unclassified')::int = 0, 'blocking', cfg.block_close_with_unclassified, 'count', (met->>'unclassified')::int),
    jsonb_build_object('key', 'missing_receipt', 'label', 'Despesas pagas com comprovante (ou dispensadas com justificativa)', 'ok', (met->>'missing_receipt')::int = 0, 'blocking', cfg.require_receipt_paid_expenses, 'count', (met->>'missing_receipt')::int));
  v_can_close := v_status = 'in_review' and v_ended
    and not exists (select 1 from jsonb_array_elements(gates) g where (g->>'ok')::boolean = false and (g->>'blocking')::boolean);
  return jsonb_build_object(
    'month', v_m, 'status', v_status, 'close_seq', coalesce(per.close_seq, 0),
    'reviewed_by', private.acc_user_name(per.reviewed_by), 'reviewed_at', per.reviewed_at,
    'closed_by', private.acc_user_name(per.closed_by), 'closed_at', per.closed_at, 'close_note', per.close_note,
    'reopened_by', private.acc_user_name(per.reopened_by), 'reopened_at', per.reopened_at, 'reopen_reason', per.reopen_reason,
    'totals_at_close', per.totals, 'metrics', met, 'gates', gates, 'ready_to_close', v_can_close,
    'can_close', private.has_acc_grant('close', p_unit), 'can_reopen', private.has_acc_grant('reopen', p_unit), 'reopen_min_reason_len', cfg.reopen_min_reason_len,
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor', private.acc_user_name(e.actor_user_id), 'reason', e.reason, 'detail', e.detail, 'at', e.created_at) order by e.created_at desc)
                        from public.acc_period_events e where e.period_id = per.id), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('source_type', c.source_type, 'source_id', c.source_id, 'basis', c.basis, 'change_type', c.change_type,
                          'snapshot_cents', c.snapshot_cents, 'current_cents', c.current_cents, 'description', c.description, 'counterparty', c.counterparty))
                        from private.acc_changes(v_org, p_unit, v_m) c), '[]'::jsonb));
end $$;

create or replace function public.acc_period_request_review(p_unit uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); per public.acc_periods;
begin
  per := private.acc_period_ensure(v_org, p_unit, p_month);
  if per.status <> 'open' then raise exception 'A competência não está aberta (situação atual: %)', per.status; end if;
  update public.acc_periods set status = 'in_review', reviewed_by = (select auth.uid()), reviewed_at = now() where id = per.id;
  insert into public.acc_period_events (period_id, action, actor_user_id, detail) values (per.id, 'review_requested', (select auth.uid()), private.acc_metrics(v_org, p_unit, per.competence_month));
  return jsonb_build_object('status', 'in_review');
end $$;

create or replace function public.acc_period_withdraw_review(p_unit uuid, p_month date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); per public.acc_periods;
begin
  per := private.acc_period_ensure(v_org, p_unit, p_month);
  if per.status <> 'in_review' then raise exception 'A competência não está em revisão'; end if;
  update public.acc_periods set status = 'open', reviewed_by = null, reviewed_at = null where id = per.id;
  insert into public.acc_period_events (period_id, action, actor_user_id, reason) values (per.id, 'review_withdrawn', (select auth.uid()), nullif(btrim(p_reason), ''));
  return jsonb_build_object('status', 'open');
end $$;

create or replace function public.acc_period_close(p_unit uuid, p_month date, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); per public.acc_periods; met jsonb; cfg public.acc_settings := private.acc_settings_row(private.current_org()); v_seq int;
begin
  if not private.has_acc_grant('close', p_unit) then raise exception 'Você não tem a permissão específica de fechar competências' using errcode = '42501'; end if;
  if v_m >= private.acc_local_month(p_unit) then raise exception 'A competência % ainda está em andamento: só é possível fechar meses já encerrados', to_char(v_m, 'MM/YYYY'); end if;
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m for update;
  if not found or per.status <> 'in_review' then raise exception 'A competência precisa estar “Em revisão” para ser fechada'; end if;
  met := private.acc_metrics(v_org, p_unit, v_m);
  if cfg.block_close_with_unclassified and (met->>'unclassified')::int > 0 then
    raise exception 'Há % lançamento(s) sem classificação: classifique ou dispense com justificativa antes de fechar', met->>'unclassified'; end if;
  if cfg.require_receipt_paid_expenses and (met->>'missing_receipt')::int > 0 then
    raise exception 'Há % despesa(s) paga(s) sem comprovante: anexe ou dispense com justificativa antes de fechar', met->>'missing_receipt'; end if;
  v_seq := per.close_seq + 1;
  insert into public.acc_period_snapshot (period_id, close_seq, source_type, source_id, basis, amount_cents, fingerprint, description, counterparty)
    select per.id, v_seq, l.source_type, l.source_id, l.basis, l.signed_cents, l.fingerprint, l.description, l.counterparty
      from private.acc_ledger(v_org, p_unit, v_m, 'competencia', false) l
    union all
    select per.id, v_seq, l.source_type, l.source_id, l.basis, l.signed_cents, l.fingerprint, l.description, l.counterparty
      from private.acc_ledger(v_org, p_unit, v_m, 'caixa', false) l;
  update public.acc_periods set status = 'closed', close_seq = v_seq, closed_by = (select auth.uid()), closed_at = now(), close_note = nullif(btrim(p_note), ''), totals = met where id = per.id;
  insert into public.acc_period_events (period_id, action, actor_user_id, reason, detail) values (per.id, 'closed', (select auth.uid()), nullif(btrim(p_note), ''), met);
  perform private.adm_record_audit('acc_period_close', 'acc_periods', per.id::text, p_unit, null, null, jsonb_build_object('month', v_m, 'close_seq', v_seq, 'totals', met, 'note', nullif(btrim(p_note), '')));
  return jsonb_build_object('status', 'closed', 'close_seq', v_seq, 'totals', met);
end $$;

create or replace function public.acc_period_reopen(p_unit uuid, p_month date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); per public.acc_periods; cfg public.acc_settings := private.acc_settings_row(private.current_org()); n_ch int;
begin
  if not private.has_acc_grant('reopen', p_unit) then raise exception 'Você não tem a permissão específica de reabrir competências' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < cfg.reopen_min_reason_len then raise exception 'Justifique a reabertura (mínimo de % caracteres)', cfg.reopen_min_reason_len; end if;
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m for update;
  if not found or per.status <> 'closed' then raise exception 'Só é possível reabrir uma competência fechada'; end if;
  select count(*) into n_ch from private.acc_changes(v_org, p_unit, v_m);
  update public.acc_periods set status = 'open', reopened_by = (select auth.uid()), reopened_at = now(), reopen_reason = btrim(p_reason), reviewed_by = null, reviewed_at = null where id = per.id;
  insert into public.acc_period_events (period_id, action, actor_user_id, reason, detail)
    values (per.id, 'reopened', (select auth.uid()), btrim(p_reason), jsonb_build_object('close_seq', per.close_seq, 'pending_changes', n_ch, 'totals_at_close', per.totals));
  perform private.adm_record_audit('acc_period_reopen', 'acc_periods', per.id::text, p_unit, null, null,
    jsonb_build_object('month', v_m, 'close_seq', per.close_seq, 'reason', btrim(p_reason), 'pending_changes', n_ch));
  return jsonb_build_object('status', 'open', 'pending_changes', n_ch);
end $$;

-- aceitar (revisar) uma alteração posterior ao fechamento, sem reabrir. Exige a permissão de fechar.
create or replace function public.acc_change_accept(p_unit uuid, p_month date, p_source_type text, p_source_id uuid, p_basis text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); per public.acc_periods; ch record;
begin
  if not private.has_acc_grant('close', p_unit) then raise exception 'Você não tem a permissão específica de fechar competências' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Informe a justificativa da aceitação (mínimo de 5 caracteres)'; end if;
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m and status = 'closed';
  if not found then raise exception 'A competência não está fechada'; end if;
  select * into ch from private.acc_changes(v_org, p_unit, v_m) c where c.source_type = p_source_type and c.source_id = p_source_id and c.basis = p_basis;
  if not found then raise exception 'Não há alteração pendente para este lançamento'; end if;
  insert into public.acc_change_reviews (period_id, close_seq, source_type, source_id, basis, fingerprint, note, reviewed_by)
    values (per.id, per.close_seq, p_source_type, p_source_id, p_basis, ch.fingerprint, btrim(p_note), (select auth.uid()));
  insert into public.acc_period_events (period_id, action, actor_user_id, reason, detail)
    values (per.id, 'change_accepted', (select auth.uid()), btrim(p_note), jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'basis', p_basis, 'change_type', ch.change_type, 'snapshot_cents', ch.snapshot_cents, 'current_cents', ch.current_cents));
  perform private.adm_record_audit('acc_change_accept', 'acc_periods', per.id::text, p_unit, null, null, jsonb_build_object('source_id', p_source_id, 'change_type', ch.change_type, 'note', btrim(p_note)));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- exportação para o contador
create or replace function public.acc_export_data(p_unit uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); v_names boolean := private.can_acc_see_names(p_unit); per public.acc_periods; v_status text;
begin
  select * into per from public.acc_periods where unit_id = p_unit and competence_month = v_m; v_status := coalesce(per.status, 'open');
  return jsonb_build_object(
    'generated_at', now(), 'provisional', v_status <> 'closed', 'period_status', v_status,
    'organization', (select o.name from public.organizations o where o.id = v_org),
    'unit', (select jsonb_build_object('id', u.id, 'name', u.name, 'legal_name', e.legal_name, 'cnpj', e.cnpj) from public.units u left join public.legal_entities e on e.id = u.legal_entity_id where u.id = p_unit),
    'month', v_m, 'closed_at', per.closed_at, 'closed_by', private.acc_user_name(per.closed_by), 'close_note', per.close_note, 'close_seq', coalesce(per.close_seq, 0),
    'names_visible', v_names, 'metrics', private.acc_metrics(v_org, p_unit, v_m),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
        'basis', l.basis, 'date', l.entry_date, 'competence_month', l.competence_month, 'kind', l.kind, 'description', l.description, 'counterparty', l.counterparty,
        'amount_cents', l.signed_cents, 'status', l.row_status, 'category', l.category_name,
        'account_code', (select a.code from public.acc_accounts a where a.id = l.account_id), 'account_name', l.account_name,
        'documents', l.doc_count, 'source_type', l.source_type, 'source_id', l.source_id) order by l.basis, l.entry_date, l.description)
      from (select * from private.acc_ledger(v_org, p_unit, v_m, 'competencia', v_names) union all select * from private.acc_ledger(v_org, p_unit, v_m, 'caixa', v_names)) l), '[]'::jsonb),
    'pendencies', coalesce((public.acc_pendencies(p_unit, v_m, null))->'rows', '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'source_type', d.source_type, 'source_id', d.source_id, 'mime', d.mime, 'uploaded_at', d.uploaded_at) order by d.uploaded_at)
      from public.acc_documents d where d.org_id = v_org and d.unit_id = p_unit and d.removed_at is null
        and (d.competence_month = v_m or d.source_id in (select l.source_id from private.acc_ledger(v_org, p_unit, v_m, 'competencia', false) l))), '[]'::jsonb));
end $$;

create or replace function public.acc_export_log(p_unit uuid, p_month date, p_format text, p_rows int, p_docs int, p_checksum text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit); v_m date := private.acc_month(p_month); v_status text; v_id uuid;
begin
  if p_format not in ('csv','zip') then raise exception 'Formato inválido'; end if;
  select coalesce((select status from public.acc_periods where unit_id = p_unit and competence_month = v_m), 'open') into v_status;
  insert into public.acc_exports (org_id, unit_id, competence_month, basis, format, row_count, doc_count, period_status, checksum, created_by)
    values (v_org, p_unit, v_m, 'ambas', p_format, greatest(coalesce(p_rows, 0), 0), greatest(coalesce(p_docs, 0), 0), v_status, left(p_checksum, 128), (select auth.uid())) returning id into v_id;
  perform private.adm_record_audit('acc_export', 'acc_exports', v_id::text, p_unit, null, null, jsonb_build_object('month', v_m, 'format', p_format, 'rows', p_rows, 'documents', p_docs, 'period_status', v_status));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.acc_export_list(p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.acc_check(p_unit);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'competence_month', x.competence_month, 'format', x.format, 'row_count', x.row_count, 'doc_count', x.doc_count,
      'period_status', x.period_status, 'checksum', x.checksum, 'created_at', x.created_at, 'created_by', private.acc_user_name(x.created_by)) order by x.created_at desc)
    from (select * from public.acc_exports e where e.org_id = v_org and e.unit_id = p_unit order by e.created_at desc limit 50) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- configurações contábeis
create or replace function public.acc_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_admin boolean := private.can_acc_admin(); cfg public.acc_settings := private.acc_settings_row(private.current_org());
begin
  if v_org is null or not private.can_acc_any() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object(
    'is_admin', v_admin,
    'settings', jsonb_build_object('require_receipt_paid_expenses', cfg.require_receipt_paid_expenses, 'receipt_min_cents', cfg.receipt_min_cents,
                                   'block_close_with_unclassified', cfg.block_close_with_unclassified, 'reopen_min_reason_len', cfg.reopen_min_reason_len),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'kind', a.kind, 'active', a.active,
        'uses', (select count(*) from public.acc_classifications c where c.account_id = a.id)) order by a.code) from public.acc_accounts a where a.org_id = v_org), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', fc.id, 'name', fc.name, 'kind', fc.kind, 'account_id', m.account_id) order by fc.kind, fc.name)
        from public.finance_categories fc left join public.acc_category_map m on m.category_id = fc.id where fc.org_id = v_org and fc.active), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'legal_entity_id', u.legal_entity_id) order by u.name)
        from public.units u where u.org_id = v_org and u.active and private.can_acc(u.id)), '[]'::jsonb),
    'legal_entities', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.legal_name, 'cnpj', e.cnpj) order by e.legal_name)
        from public.legal_entities e where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null), '[]'::jsonb) else '[]'::jsonb end,
    'people', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', coalesce(nullif(x.display_name, ''), x.email::text), 'email', x.email::text,
        'roles', x.roles, 'grants', coalesce((select jsonb_agg(jsonb_build_object('permission', g.permission, 'unit_id', g.unit_id)) from public.acc_grants g where g.user_id = x.user_id and g.revoked_at is null), '[]'::jsonb)) order by x.email::text)
      from (select ua.user_id, ua.display_name, ua.email, array_agg(distinct ra.role::text) roles from public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
              where ra.org_id = v_org and ra.revoked_at is null and ra.role = any (array['manager','ops_admin','unit_manager','finance','accountant']::public.app_role[]) group by ua.user_id, ua.display_name, ua.email) x), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.acc_settings_save(p_require_receipt boolean, p_receipt_min_cents bigint, p_block_unclassified boolean, p_reopen_min_len int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if not private.can_acc_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.acc_settings (org_id, require_receipt_paid_expenses, receipt_min_cents, block_close_with_unclassified, reopen_min_reason_len, updated_by, updated_at)
    values (v_org, coalesce(p_require_receipt, true), greatest(coalesce(p_receipt_min_cents, 0), 0), coalesce(p_block_unclassified, true), least(greatest(coalesce(p_reopen_min_len, 10), 5), 500), (select auth.uid()), now())
    on conflict (org_id) do update set require_receipt_paid_expenses = excluded.require_receipt_paid_expenses, receipt_min_cents = excluded.receipt_min_cents,
      block_close_with_unclassified = excluded.block_close_with_unclassified, reopen_min_reason_len = excluded.reopen_min_reason_len, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.acc_account_upsert(p_id uuid, p_code text, p_name text, p_kind text, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid;
begin
  if not private.can_acc_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind not in ('income','expense','other') then raise exception 'Tipo inválido'; end if;
  if length(btrim(coalesce(p_code, ''))) < 1 or length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Informe código e nome'; end if;
  if exists (select 1 from public.acc_accounts where org_id = v_org and code = btrim(p_code) and id is distinct from p_id) then raise exception 'Já existe uma classificação com este código'; end if;
  if p_id is null then
    insert into public.acc_accounts (org_id, code, name, kind, active) values (v_org, btrim(p_code), btrim(p_name), p_kind, coalesce(p_active, true)) returning id into v_id;
  else
    update public.acc_accounts set code = btrim(p_code), name = btrim(p_name), kind = p_kind, active = coalesce(p_active, true) where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then raise exception 'Classificação não encontrada'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.acc_seed_default_accounts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); n int;
begin
  if not private.can_acc_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  with ins as (
    insert into public.acc_accounts (org_id, code, name, kind) values
      (v_org,'R01','Receita de serviços e atendimentos','income'),(v_org,'R02','Receita de cursos e mentorias','income'),(v_org,'R03','Receita de pacotes e planos','income'),
      (v_org,'D01','Pessoal e encargos (registro gerencial)','expense'),(v_org,'D02','Aluguel e ocupação','expense'),(v_org,'D03','Insumos e materiais','expense'),
      (v_org,'D04','Marketing e captação','expense'),(v_org,'D05','Tarifas e serviços bancários','expense'),(v_org,'D06','Tributos e taxas (registro gerencial)','expense'),(v_org,'D07','Outras despesas','expense')
    on conflict (org_id, code) do nothing returning 1)
  select count(*) into n from ins;
  return jsonb_build_object('created', n);
end $$;

create or replace function public.acc_category_map_set(p_category uuid, p_account uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if not private.can_acc_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.finance_categories where id = p_category and org_id = v_org) then raise exception 'Categoria inexistente'; end if;
  if p_account is null then delete from public.acc_category_map where category_id = p_category and org_id = v_org;
  else
    if not exists (select 1 from public.acc_accounts where id = p_account and org_id = v_org and active) then raise exception 'Classificação inexistente ou inativa'; end if;
    insert into public.acc_category_map (category_id, org_id, account_id) values (p_category, v_org, p_account) on conflict (category_id) do update set account_id = excluded.account_id;
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.acc_unit_entity_set(p_unit uuid, p_entity uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if not private.can_acc_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.units where id = p_unit and org_id = v_org) then raise exception 'Unidade inválida'; end if;
  if p_entity is not null and not exists (select 1 from public.legal_entities where id = p_entity and org_id = v_org and archived_at is null and merged_into_id is null) then raise exception 'Pessoa jurídica inválida'; end if;
  update public.units set legal_entity_id = p_entity where id = p_unit;
  perform private.adm_record_audit('acc_unit_entity_set', 'units', p_unit::text, p_unit, null, null, jsonb_build_object('legal_entity_id', p_entity));
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.acc_grant_set(p_user uuid, p_permission text, p_unit uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if not private.can_acc_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_permission not in ('close','reopen') then raise exception 'Permissão inválida'; end if;
  if p_unit is not null and not exists (select 1 from public.units where id = p_unit and org_id = v_org) then raise exception 'Unidade inválida'; end if;
  if p_on then
    if not exists (select 1 from public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
                   where ra.user_id = p_user and ua.org_id = v_org and ra.revoked_at is null and ra.role = any (array['manager','ops_admin','unit_manager','finance','accountant']::public.app_role[])) then
      raise exception 'A pessoa precisa ter um papel contábil/financeiro para receber esta permissão'; end if;
    insert into public.acc_grants (org_id, user_id, permission, unit_id, granted_by) values (v_org, p_user, p_permission, p_unit, (select auth.uid())) on conflict do nothing;
  else
    update public.acc_grants set revoked_at = now(), revoked_by = (select auth.uid())
      where org_id = v_org and user_id = p_user and permission = p_permission and revoked_at is null and unit_id is not distinct from p_unit;
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

grant execute on function
  public.acc_context(), public.acc_dashboard(uuid, date), public.acc_periods_overview(uuid),
  public.acc_ledger_list(uuid, date, text, text, text, text, int, int), public.acc_classify(uuid, jsonb, uuid, text), public.acc_apply_suggestions(uuid, date),
  public.acc_waive(uuid, text, uuid, text, text), public.acc_pendencies(uuid, date, text),
  public.acc_document_register(uuid, date, text, uuid, text, text, text, text, bigint), public.acc_document_list(uuid, date, text, uuid),
  public.acc_documents_access(uuid[]), public.acc_document_remove(uuid, text),
  public.acc_period_detail(uuid, date), public.acc_period_request_review(uuid, date), public.acc_period_withdraw_review(uuid, date, text),
  public.acc_period_close(uuid, date, text), public.acc_period_reopen(uuid, date, text), public.acc_change_accept(uuid, date, text, uuid, text, text),
  public.acc_export_data(uuid, date), public.acc_export_log(uuid, date, text, int, int, text), public.acc_export_list(uuid),
  public.acc_config(), public.acc_settings_save(boolean, bigint, boolean, int), public.acc_account_upsert(uuid, text, text, text, boolean),
  public.acc_seed_default_accounts(), public.acc_category_map_set(uuid, uuid), public.acc_unit_entity_set(uuid, uuid), public.acc_grant_set(uuid, text, uuid, boolean)
  to authenticated;
