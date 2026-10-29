-- HP Group Hub — 095 Finanças pessoais: importação e conciliação de extratos, vínculo com retiradas da empresa e comprovantes privados.
-- Importação: só em CONTA PESSOAL escolhida pelo dono; prévia → decisão linha a linha → confirmação. Nunca grava nas contas/lançamentos da empresa. Sem conexão bancária automática.
-- Conciliação: associar a linha a um lançamento previsto LIQUIDA esse lançamento (não cria despesa nova); linha sem correspondência só vira lançamento se o dono decidir.
-- Vínculo com a empresa: aponta para uma retirada já PAGA no financeiro empresarial (exige autorização nos dois contextos); não altera nem classifica nada do lado empresarial.

-- ---------------------------------------------------------------- importação
create table public.pf_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.pf_accounts(id) on delete restrict,
  filename text, status text not null default 'previewed' check (status in ('previewed','confirmed','cancelled')),
  created_at timestamptz not null default now(), confirmed_at timestamptz
);
create table public.pf_import_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.pf_imports(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.pf_accounts(id) on delete restrict,
  row_no int not null, line_date date, description text, amount_cents bigint,            -- amount: positivo = entrada, negativo = saída
  external_id text, dedupe_hash text,
  status text not null default 'new' check (status in ('new','duplicate','invalid','matched','imported','ignored')),
  error text, suggestion jsonb, matched_entry_id uuid references public.pf_entries(id) on delete set null, created_entry_id uuid references public.pf_entries(id) on delete set null
);
create index pf_import_lines_hash on public.pf_import_lines (owner_user_id, account_id, dedupe_hash) where status in ('matched','imported');
create index pf_import_lines_import on public.pf_import_lines (import_id);
do $$
declare t text;
begin
  foreach t in array array['pf_imports','pf_import_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_user_id = (select private.pf_user()))', t || '_owner_read', t);
  end loop;
end $$;
alter table public.pf_settlements add constraint pf_settlements_import_line_fk foreign key (import_line_id) references public.pf_import_lines(id) on delete set null;

-- prévia: valida cada linha, detecta duplicidade (mesma conta+data+valor+descrição, contando repetições dentro do arquivo) e sugere lançamentos previstos; NÃO altera nada além do rascunho da importação
create or replace function public.pf_import_preview(p_account uuid, p_filename text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_today date := private.pf_today(); a public.pf_accounts; v_imp uuid; r jsonb; i int := 0; v_date date; v_amt bigint; v_desc text; v_hash text; v_seq int;
  v_status text; v_err text; v_sug jsonb; v_cnt jsonb := jsonb_build_object('new', 0, 'duplicate', 0, 'invalid', 0); seen jsonb := '{}'::jsonb; base text; e record; o record;
begin
  select * into a from public.pf_accounts where id = p_account and owner_user_id = v_user and active; if not found then raise exception 'escolha a conta pessoal que recebe o extrato'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'nenhuma linha para importar'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'o arquivo passa de 2.000 linhas: divida em partes'; end if;
  insert into public.pf_imports (org_id, owner_user_id, account_id, filename) values (v_org, v_user, p_account, left(p_filename, 200)) returning id into v_imp;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_status := 'new'; v_err := null; v_sug := null; v_date := null; v_amt := null; v_hash := null;
    begin v_date := (r ->> 'date')::date; exception when others then v_err := 'data inválida'; end;
    begin v_amt := (r ->> 'amount_cents')::bigint; exception when others then v_err := coalesce(v_err || '; ', '') || 'valor inválido'; end;
    v_desc := nullif(btrim(coalesce(r ->> 'description', '')), '');
    if v_err is null and (v_amt is null or v_amt = 0) then v_err := 'valor zerado ou ausente'; end if;
    if v_err is null and v_date is not null and (v_date > v_today or v_date < date '2000-01-01') then v_err := 'data fora do intervalo permitido'; end if;
    if v_err is null and v_date < a.opening_date then v_err := 'data anterior ao saldo inicial da conta'; end if;
    if v_err is null and v_desc is null then v_err := 'descrição ausente'; end if;
    if v_err is not null then v_status := 'invalid';
    else
      base := p_account::text || '|' || v_date::text || '|' || v_amt::text || '|' || lower(regexp_replace(v_desc, '\s+', ' ', 'g'));
      v_seq := coalesce((seen ->> base)::int, 0) + 1; seen := seen || jsonb_build_object(base, v_seq);
      v_hash := md5(base || '|' || v_seq::text);
      if exists (select 1 from public.pf_import_lines l where l.owner_user_id = v_user and l.account_id = p_account and l.dedupe_hash = v_hash and l.status in ('matched','imported')) then v_status := 'duplicate'; end if;
    end if;
    if v_status = 'new' then   -- correspondência exata com um lançamento previsto (valor restante igual, vencimento até 10 dias de diferença); virtual também
      select e2.id, e2.description, e2.due_date into e from (
        select x.id, x.description, x.due_date from public.pf_entries x
         where x.owner_user_id = v_user and x.card_id is null and x.status in ('planned','open','partial') and x.kind = (case when v_amt > 0 then 'income' else 'expense' end)
           and (x.amount_cents - x.settled_cents) = abs(v_amt) and abs(x.due_date - v_date) <= 10 order by abs(x.due_date - v_date) limit 1) e2;
      if found then v_sug := jsonb_build_object('type', 'entry', 'entry_id', e.id, 'description', e.description, 'due_date', e.due_date);
      else
        select s.id sid, s.description sdesc, oc.occ_date into o from public.pf_series s cross join lateral private.pf_occurrences(s.id, v_date - 10, v_date + 10) oc
         where s.owner_user_id = v_user and s.card_id is null and s.kind = (case when v_amt > 0 then 'income' else 'expense' end) and (s.amount_cents = abs(v_amt) or s.nature = 'variable')
           and not exists (select 1 from public.pf_entries y where y.series_root_id = s.root_id and y.occurrence_date = oc.occ_date) order by (s.amount_cents = abs(v_amt)) desc, abs(oc.occ_date - v_date) limit 1;
        if found then v_sug := jsonb_build_object('type', 'virtual', 'series_id', o.sid, 'occurrence_date', o.occ_date, 'description', o.sdesc); end if;
      end if;
    end if;
    v_cnt := jsonb_set(v_cnt, array[v_status], to_jsonb(coalesce((v_cnt ->> v_status)::int, 0) + 1));
    insert into public.pf_import_lines (import_id, owner_user_id, account_id, row_no, line_date, description, amount_cents, external_id, dedupe_hash, status, error, suggestion)
      values (v_imp, v_user, p_account, i, v_date, left(v_desc, 140), v_amt, left(r ->> 'external_id', 80), v_hash, v_status, v_err, v_sug);
  end loop;
  return jsonb_build_object('import_id', v_imp, 'counts', v_cnt, 'lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'owner_user_id' - 'dedupe_hash' order by l.row_no), '[]'::jsonb) from public.pf_import_lines l where l.import_id = v_imp));
end $$;
revoke all on function public.pf_import_preview(uuid, text, jsonb) from public, anon;
grant execute on function public.pf_import_preview(uuid, text, jsonb) to authenticated;

-- confirmação: aplica SOMENTE as decisões enviadas ({line_id, action: match|create|ignore, ...}); tudo ou nada
create or replace function public.pf_import_confirm(p_import uuid, p_decisions jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); imp public.pf_imports; d jsonb; l public.pf_import_lines; v_eid uuid; v_ref jsonb; e public.pf_entries; v_abs bigint; v_res jsonb; v_new uuid;
  v_match int := 0; v_create int := 0; v_ign int := 0; v_nat text; v_cat uuid; v_kind text;
begin
  select * into imp from public.pf_imports where id = p_import and owner_user_id = v_user for update; if not found then raise exception 'importação não encontrada'; end if;
  if imp.status = 'cancelled' then raise exception 'importação cancelada'; end if;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then raise exception 'nenhuma decisão para aplicar'; end if;
  for d in select * from jsonb_array_elements(p_decisions) loop
    v_nat := null;
    select * into l from public.pf_import_lines where id = (d ->> 'line_id')::uuid and import_id = imp.id and owner_user_id = v_user for update;
    if not found then raise exception 'linha não pertence a esta importação'; end if;
    if l.status in ('matched','imported','ignored') then raise exception 'a linha % já foi tratada', l.row_no; end if;
    if d ->> 'action' = 'ignore' then update public.pf_import_lines set status = 'ignored' where id = l.id; v_ign := v_ign + 1; continue; end if;
    if l.status <> 'new' then raise exception 'a linha % está como "%" e não pode ser aplicada', l.row_no, l.status; end if;
    v_abs := abs(l.amount_cents); v_kind := case when l.amount_cents > 0 then 'income' else 'expense' end;
    if d ->> 'action' = 'match' then
      v_ref := coalesce(d -> 'ref', l.suggestion); if v_ref is null then raise exception 'a linha % não tem lançamento para associar', l.row_no; end if;
      v_ref := jsonb_strip_nulls(jsonb_build_object('entry_id', v_ref ->> 'entry_id', 'series_id', v_ref ->> 'series_id', 'occurrence_date', v_ref ->> 'occurrence_date'));
      if v_ref ? 'series_id' then select nature into v_nat from public.pf_series where id = (v_ref ->> 'series_id')::uuid and owner_user_id = v_user; end if;
      v_eid := private.pf_resolve(v_user, v_ref, case when v_nat = 'variable' then v_abs end);
      select * into e from public.pf_entries where id = v_eid; if e.kind <> v_kind then raise exception 'a linha % é de % e o lançamento é de %', l.row_no, v_kind, e.kind; end if;
      v_res := public.pf_entry_settle(jsonb_build_object('entry_id', v_eid), v_abs, l.line_date, imp.account_id, e.nature = 'variable' and v_abs <> (e.amount_cents - e.settled_cents), 'import:' || l.id);
      update public.pf_settlements set source = 'import', import_line_id = l.id where id = (v_res ->> 'settlement_id')::uuid;
      update public.pf_import_lines set status = 'matched', matched_entry_id = v_eid where id = l.id; v_match := v_match + 1;
    elsif d ->> 'action' = 'create' then
      v_cat := nullif(d ->> 'category_id', '')::uuid;
      v_res := public.pf_entry_create(jsonb_build_object('kind', v_kind, 'description', coalesce(nullif(btrim(d ->> 'description'), ''), l.description), 'amount_cents', v_abs, 'category_id', v_cat, 'account_id', imp.account_id,
                 'due_date', l.line_date, 'competence_date', l.line_date, 'idempotency_key', 'import-create:' || l.id));
      v_new := (v_res ->> 'id')::uuid;
      v_res := public.pf_entry_settle(jsonb_build_object('entry_id', v_new), v_abs, l.line_date, imp.account_id, false, 'import:' || l.id);
      update public.pf_settlements set source = 'import', import_line_id = l.id where id = (v_res ->> 'settlement_id')::uuid;
      update public.pf_import_lines set status = 'imported', created_entry_id = v_new where id = l.id; v_create := v_create + 1;
    else raise exception 'ação inválida na linha %', l.row_no; end if;
  end loop;
  update public.pf_imports set status = 'confirmed', confirmed_at = now() where id = imp.id;
  return jsonb_build_object('matched', v_match, 'created', v_create, 'ignored', v_ign, 'pending', (select count(*) from public.pf_import_lines where import_id = imp.id and status = 'new'));
end $$;
revoke all on function public.pf_import_confirm(uuid, jsonb) from public, anon;
grant execute on function public.pf_import_confirm(uuid, jsonb) to authenticated;

create or replace function public.pf_import_cancel(p_import uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  update public.pf_imports set status = 'cancelled' where id = p_import and owner_user_id = v_user and status = 'previewed';
  if not found then raise exception 'importação não encontrada ou já confirmada'; end if;
end $$;
revoke all on function public.pf_import_cancel(uuid) from public, anon;
grant execute on function public.pf_import_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------- vínculo com retiradas da empresa
create table public.pf_business_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  payable_id uuid not null references public.payables(id) on delete restrict,
  entry_id uuid references public.pf_entries(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','linked')),
  note text, idempotency_key text,
  created_at timestamptz not null default now(), resolved_at timestamptz,
  unique (payable_id),
  check ((status = 'linked') = (entry_id is not null))
);
create unique index pf_business_links_entry on public.pf_business_links (entry_id) where entry_id is not null;
create unique index pf_business_links_key on public.pf_business_links (owner_user_id, idempotency_key) where idempotency_key is not null;
alter table public.pf_business_links enable row level security;
revoke all on public.pf_business_links from anon, authenticated;
grant select on public.pf_business_links to authenticated;
create policy pf_business_links_owner_read on public.pf_business_links for select to authenticated using (owner_user_id = (select private.pf_user()));

-- retiradas pagas que o usuário PODE ver no empresarial (papel financeiro na unidade) e que ainda não foram vinculadas
create or replace function public.pf_business_withdrawals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  return jsonb_build_object('payables', coalesce((select jsonb_agg(jsonb_build_object('payable_id', p.id, 'description', p.description, 'supplier', p.supplier, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at, 'due_date', p.due_date,
        'unit', u.name, 'category', c.name, 'link_id', l.id, 'link_status', l.status,
        'looks_like_withdrawal', coalesce(c.name, '') ~* '(retirada|pr[oó].?labore|distribui|reembolso)' or p.description ~* '(retirada|pr[oó].?labore|distribui|reembolso)') order by p.paid_at desc nulls last)
    from public.payables p join public.units u on u.id = p.unit_id left join public.finance_categories c on c.id = p.category_id
    left join public.pf_business_links l on l.payable_id = p.id and l.owner_user_id = v_user
    where p.org_id = private.pf_org() and p.status = 'paid' and private.can_finance(p.unit_id)
      and (coalesce(c.name, '') ~* '(retirada|pr[oó].?labore|distribui|reembolso)' or p.description ~* '(retirada|pr[oó].?labore|distribui|reembolso)' or l.id is not null)), '[]'::jsonb));
end $$;
revoke all on function public.pf_business_withdrawals() from public, anon;
grant execute on function public.pf_business_withdrawals() to authenticated;

-- vincula; sem lançamento pessoal informado cria a PENDÊNCIA (recuperável); com `p_create` cria e liquida a entrada pessoal na hora, de forma atômica
create or replace function public.pf_link_business_withdrawal(p_payable uuid, p_entry uuid default null, p_create jsonb default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_key text := nullif(btrim(coalesce(p_key, '')), ''); pay public.payables; lk public.pf_business_links; e public.pf_entries; v_new uuid; v_res jsonb; v_lk uuid;
begin
  if v_key is not null then select * into lk from public.pf_business_links where owner_user_id = v_user and idempotency_key = v_key; if found then return jsonb_build_object('link_id', lk.id, 'status', lk.status, 'duplicate', true); end if; end if;
  select * into pay from public.payables where id = p_payable and org_id = v_org and status = 'paid';
  if not found or not private.can_finance(pay.unit_id) then raise exception 'retirada não encontrada ou sem permissão no financeiro empresarial' using errcode = '42501'; end if;
  select * into lk from public.pf_business_links where payable_id = p_payable;
  if found then
    if lk.owner_user_id <> v_user then raise exception 'esta retirada já está vinculada por outro usuário'; end if;
    if p_entry is null and p_create is null then return jsonb_build_object('link_id', lk.id, 'status', lk.status, 'duplicate', true); end if;
    return public.pf_resolve_withdrawal_link(lk.id, p_entry, p_create);
  end if;
  if p_entry is not null or p_create is not null then
    insert into public.pf_business_links (org_id, owner_user_id, payable_id, status, entry_id, idempotency_key)
      values (v_org, v_user, p_payable, 'pending', null, v_key) returning id into v_lk;   -- check (linked ⇔ entry) é satisfeito depois, na mesma transação
  else
    insert into public.pf_business_links (org_id, owner_user_id, payable_id, status, idempotency_key) values (v_org, v_user, p_payable, 'pending', v_key) returning id into v_lk;
    return jsonb_build_object('link_id', v_lk, 'status', 'pending', 'note', 'retirada registrada; falta apontar a entrada pessoal (pendência recuperável)');
  end if;
  return public.pf_resolve_withdrawal_link(v_lk, p_entry, p_create);
end $$;
revoke all on function public.pf_link_business_withdrawal(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.pf_link_business_withdrawal(uuid, uuid, jsonb, text) to authenticated;

create or replace function public.pf_resolve_withdrawal_link(p_link uuid, p_entry uuid default null, p_create jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); lk public.pf_business_links; pay public.payables; e public.pf_entries; v_new uuid; v_res jsonb; v_date date; v_today date := private.pf_today();
begin
  select * into lk from public.pf_business_links where id = p_link and owner_user_id = v_user for update; if not found then raise exception 'vínculo não encontrado'; end if;
  if lk.status = 'linked' then return jsonb_build_object('link_id', lk.id, 'status', 'linked', 'entry_id', lk.entry_id, 'duplicate', true); end if;
  select * into pay from public.payables where id = lk.payable_id;
  if not private.can_finance(pay.unit_id) then raise exception 'sem permissão no financeiro empresarial' using errcode = '42501'; end if;
  if p_entry is null and p_create is null then raise exception 'informe o lançamento pessoal ou os dados para criá-lo'; end if;
  if p_create is not null then
    v_date := coalesce(nullif(p_create ->> 'date', '')::date, (pay.paid_at at time zone 'America/Sao_Paulo')::date, v_today);
    v_res := public.pf_entry_create(jsonb_build_object('kind', 'income', 'description', coalesce(nullif(btrim(p_create ->> 'description'), ''), 'Retirada da empresa: ' || pay.description), 'amount_cents', pay.amount_cents,
              'category_id', nullif(p_create ->> 'category_id', ''), 'account_id', p_create ->> 'account_id', 'due_date', v_date, 'competence_date', v_date, 'idempotency_key', 'bizlink:' || lk.id));
    v_new := (v_res ->> 'id')::uuid;
    perform public.pf_entry_settle(jsonb_build_object('entry_id', v_new), pay.amount_cents, least(v_date, v_today), (p_create ->> 'account_id')::uuid, false, 'bizlink:' || lk.id);
  else
    select * into e from public.pf_entries where id = p_entry and owner_user_id = v_user;
    if not found or e.kind <> 'income' or e.status = 'cancelled' or e.card_id is not null then raise exception 'escolha uma receita pessoal (não cancelada)'; end if;
    if e.amount_cents <> pay.amount_cents then raise exception 'os valores diferem (retirada R$ % × entrada R$ %): ajuste um dos lados antes de vincular', to_char(pay.amount_cents / 100.0, 'FM999G999G990D00'), to_char(e.amount_cents / 100.0, 'FM999G999G990D00'); end if;
    if exists (select 1 from public.pf_business_links where entry_id = p_entry) then raise exception 'esta receita já está vinculada a outra retirada'; end if;
    v_new := p_entry;
  end if;
  update public.pf_business_links set entry_id = v_new, status = 'linked', resolved_at = now() where id = lk.id;
  perform private.pf_event(v_user, v_new, null, 'business_link', jsonb_build_object('payable_id', lk.payable_id));
  return jsonb_build_object('link_id', lk.id, 'status', 'linked', 'entry_id', v_new);
end $$;
revoke all on function public.pf_resolve_withdrawal_link(uuid, uuid, jsonb) from public, anon;
grant execute on function public.pf_resolve_withdrawal_link(uuid, uuid, jsonb) to authenticated;

create or replace function public.pf_business_links_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  return jsonb_build_object('links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'created_at', l.created_at, 'payable_id', l.payable_id, 'payable_description', p.description, 'amount_cents', p.amount_cents,
      'entry_id', l.entry_id, 'entry_description', e.description) order by l.created_at desc)
    from public.pf_business_links l left join public.payables p on p.id = l.payable_id and private.can_finance(p.unit_id) left join public.pf_entries e on e.id = l.entry_id where l.owner_user_id = v_user), '[]'::jsonb));
end $$;
revoke all on function public.pf_business_links_list() from public, anon;
grant execute on function public.pf_business_links_list() to authenticated;

-- ---------------------------------------------------------------- comprovantes privados (Storage)
insert into storage.buckets (id, name, public) values ('pf-private', 'pf-private', false) on conflict (id) do nothing;
create policy pf_obj_read on storage.objects for select to authenticated using (bucket_id = 'pf-private' and (storage.foldername(name))[1] = (select private.pf_user())::text);
create policy pf_obj_write on storage.objects for insert to authenticated with check (bucket_id = 'pf-private' and (storage.foldername(name))[1] = (select private.pf_user())::text);
create policy pf_obj_update on storage.objects for update to authenticated using (bucket_id = 'pf-private' and (storage.foldername(name))[1] = (select private.pf_user())::text);
create policy pf_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'pf-private' and (storage.foldername(name))[1] = (select private.pf_user())::text);

create or replace function public.pf_entry_set_receipt(p_entry uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  if p_path is not null and (split_part(p_path, '/', 1) <> v_user::text or length(p_path) > 300 or p_path ~ '\.\.') then raise exception 'caminho de comprovante inválido'; end if;
  update public.pf_entries set receipt_path = p_path where id = p_entry and owner_user_id = v_user;
  if not found then raise exception 'lançamento não encontrado'; end if;
end $$;
revoke all on function public.pf_entry_set_receipt(uuid, text) from public, anon;
grant execute on function public.pf_entry_set_receipt(uuid, text) to authenticated;
