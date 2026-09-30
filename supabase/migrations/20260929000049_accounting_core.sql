-- HP Group Hub — 049 App Contábil: núcleo (permissões, competências, classificação, documentos, snapshot de fechamento).
--
-- PRINCÍPIOS
--  · NENHUMA transação é copiada. Lançamentos vêm de public.receivables / payables / payments (Financeiro) através de
--    private.acc_ledger(), que só LÊ. Classificações, comprovantes e fechamentos ficam em tabelas próprias que
--    apontam para o registro do Financeiro por (source_type, source_id).
--  · CAIXA ≠ COMPETÊNCIA. O livro é sempre consultado numa base: 'competencia' (receivables/payables por
--    competence_month) ou 'caixa' (payments e payables pagos, pela data do pagamento no fuso da unidade). Nunca somadas.
--  · Escopo é da UNIDADE OPERACIONAL (units) dentro da organização (tenant). Unidade ≠ empresa cliente da plataforma.
--    A unidade pode apontar para uma PJ do ADM (units.legal_entity_id) — o CNPJ que responde por ela.
--  · Isto NÃO é escrituração oficial nem apuração de tributos: é a preparação gerencial da competência para o contador.

-- ---------------------------------------------------------------- unidade ↔ PJ do ADM
alter table public.units add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete set null;

-- ---------------------------------------------------------------- permissões
create or replace function private.can_acc(p_unit uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_unit is not null and private.has_unit_role(array['manager','ops_admin','unit_manager','finance','accountant']::public.app_role[], p_unit)
$$;
create or replace function private.can_acc_any() returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments ra
    join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
    where ra.user_id = (select auth.uid()) and ra.role = any (array['manager','ops_admin','unit_manager','finance','accountant']::public.app_role[])
      and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()))
$$;
-- configurar o app (plano de classificação, parâmetros, concessões): só gestor / administrador operacional da organização
create or replace function private.can_acc_admin() returns boolean
language sql stable set search_path = '' as $$ select private.has_org_role(array['manager','ops_admin']::public.app_role[]) $$;
-- nomes de pacientes nos lançamentos: quem já enxerga vendas/financeiro da unidade. O contador recebe pseudônimo.
create or replace function private.can_acc_see_names(p_unit uuid) returns boolean
language sql stable set search_path = '' as $$
  select private.has_unit_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[], p_unit)
$$;

-- ---------------------------------------------------------------- concessões específicas (fechar / reabrir)
create table public.acc_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('close','reopen')),
  unit_id uuid references public.units(id) on delete cascade,        -- null = todas as unidades em que o usuário tem papel contábil
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);
create unique index acc_grants_active_uq on public.acc_grants (user_id, permission, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;

-- a concessão só vale enquanto a pessoa ainda tem papel contábil na unidade (revogar o papel revoga o poder na hora)
create or replace function private.has_acc_grant(p_permission text, p_unit uuid) returns boolean
language sql stable set search_path = '' as $$
  select private.can_acc(p_unit) and exists (
    select 1 from public.acc_grants g
    where g.user_id = (select auth.uid()) and g.permission = p_permission and g.revoked_at is null
      and g.org_id = private.current_org() and (g.unit_id is null or g.unit_id = p_unit))
$$;

-- ---------------------------------------------------------------- configuração da organização (nada disso é código)
create table public.acc_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  require_receipt_paid_expenses boolean not null default true,     -- despesa paga exige comprovante para fechar
  receipt_min_cents bigint not null default 0 check (receipt_min_cents >= 0),   -- só exige a partir deste valor (0 = qualquer)
  block_close_with_unclassified boolean not null default true,
  reopen_min_reason_len int not null default 10 check (reopen_min_reason_len between 5 and 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- classificação gerencial (NÃO é o plano de contas oficial — o contador mapeia para o plano dele)
create table public.acc_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (length(btrim(code)) between 1 and 20),
  name text not null check (length(btrim(name)) between 2 and 120),
  kind text not null check (kind in ('income','expense','other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create table public.acc_category_map (
  category_id uuid primary key references public.finance_categories(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.acc_accounts(id) on delete cascade
);

-- ---------------------------------------------------------------- classificação e dispensas
create table public.acc_classifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  source_type text not null check (source_type in ('receivable','payable')),
  source_id uuid not null,
  account_id uuid not null references public.acc_accounts(id) on delete restrict,
  note text,
  classified_by uuid references auth.users(id) on delete set null,
  classified_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create index acc_classifications_unit_idx on public.acc_classifications (unit_id);
create table public.acc_waivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  source_type text not null check (source_type in ('receivable','payable','payment')),
  source_id uuid not null,
  waiver_kind text not null check (waiver_kind in ('classification','receipt')),
  reason text not null check (length(btrim(reason)) >= 5),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id, waiver_kind)
);

-- ---------------------------------------------------------------- documentos (arquivo em bucket privado)
create table public.acc_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  competence_month date not null check (extract(day from competence_month) = 1),
  source_type text not null check (source_type in ('receivable','payable','payment','period')),
  source_id uuid,                                    -- null quando source_type = 'period' (documento da competência)
  kind text not null default 'comprovante' check (kind in ('comprovante','nota_fiscal','contrato','extrato','outro')),
  title text not null check (length(btrim(title)) >= 2),
  storage_path text not null unique,
  mime text, size_bytes bigint check (size_bytes is null or size_bytes between 1 and 20971520),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid references auth.users(id) on delete set null, removed_reason text,
  check ((source_type = 'period') = (source_id is null))
);
create index acc_documents_unit_month_idx on public.acc_documents (unit_id, competence_month);
create index acc_documents_source_idx on public.acc_documents (source_type, source_id) where removed_at is null;

-- ---------------------------------------------------------------- competências (fechamento)
create table public.acc_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  competence_month date not null check (extract(day from competence_month) = 1),
  status text not null default 'open' check (status in ('open','in_review','closed')),
  close_seq int not null default 0,                  -- incrementa a cada fechamento; o snapshot vigente é o desta versão
  reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null, closed_at timestamptz, close_note text,
  reopened_by uuid references auth.users(id) on delete set null, reopened_at timestamptz, reopen_reason text,
  totals jsonb,                                      -- indicadores no momento do fechamento
  created_at timestamptz not null default now(),
  unique (unit_id, competence_month)
);
create table public.acc_period_events (
  id bigint generated always as identity primary key,
  period_id uuid not null references public.acc_periods(id) on delete cascade,
  action text not null check (action in ('review_requested','review_withdrawn','closed','reopened','change_accepted')),
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index acc_period_events_idx on public.acc_period_events (period_id, created_at desc);
-- impressão digital de cada lançamento no fechamento (não é cópia da transação: só o suficiente para detectar mudança)
create table public.acc_period_snapshot (
  period_id uuid not null references public.acc_periods(id) on delete cascade,
  close_seq int not null,
  source_type text not null, source_id uuid not null, basis text not null check (basis in ('competencia','caixa')),
  amount_cents bigint not null, fingerprint text not null,
  description text, counterparty text,
  primary key (period_id, close_seq, source_type, source_id, basis)
);
-- alteração posterior ao fechamento revisada e aceita (vale para aquela impressão digital; se mudar de novo, volta a sinalizar)
create table public.acc_change_reviews (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.acc_periods(id) on delete cascade,
  source_type text not null, source_id uuid not null, basis text not null,
  fingerprint text not null,
  note text not null check (length(btrim(note)) >= 5),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  unique (period_id, source_type, source_id, basis, fingerprint)
);
create table public.acc_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  competence_month date not null,
  basis text not null check (basis in ('competencia','caixa')),
  format text not null check (format in ('csv','zip')),
  row_count int not null default 0, doc_count int not null default 0,
  period_status text not null,
  checksum text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index acc_exports_idx on public.acc_exports (unit_id, created_at desc);

-- ---------------------------------------------------------------- RLS: leitura por unidade; escrita SOMENTE pelas RPCs
alter table public.acc_grants enable row level security;
alter table public.acc_settings enable row level security;
alter table public.acc_accounts enable row level security;
alter table public.acc_category_map enable row level security;
alter table public.acc_classifications enable row level security;
alter table public.acc_waivers enable row level security;
alter table public.acc_documents enable row level security;
alter table public.acc_periods enable row level security;
alter table public.acc_period_events enable row level security;
alter table public.acc_period_snapshot enable row level security;
alter table public.acc_change_reviews enable row level security;
alter table public.acc_exports enable row level security;
grant select on public.acc_grants, public.acc_settings, public.acc_accounts, public.acc_category_map, public.acc_classifications, public.acc_waivers,
  public.acc_documents, public.acc_periods, public.acc_period_events, public.acc_period_snapshot, public.acc_change_reviews, public.acc_exports to authenticated;

create policy acc_grants_read on public.acc_grants for select to authenticated using (private.in_org(org_id) and (private.can_acc_admin() or user_id = (select auth.uid())));
create policy acc_settings_read on public.acc_settings for select to authenticated using (private.in_org(org_id) and private.can_acc_any());
create policy acc_accounts_read on public.acc_accounts for select to authenticated using (private.in_org(org_id) and private.can_acc_any());
create policy acc_category_map_read on public.acc_category_map for select to authenticated using (private.in_org(org_id) and private.can_acc_any());
create policy acc_classifications_read on public.acc_classifications for select to authenticated using (private.in_org(org_id) and private.can_acc(unit_id));
create policy acc_waivers_read on public.acc_waivers for select to authenticated using (private.in_org(org_id) and private.can_acc(unit_id));
create policy acc_documents_read on public.acc_documents for select to authenticated using (private.in_org(org_id) and private.can_acc(unit_id));
create policy acc_periods_read on public.acc_periods for select to authenticated using (private.in_org(org_id) and private.can_acc(unit_id));
create policy acc_period_events_read on public.acc_period_events for select to authenticated
  using (exists (select 1 from public.acc_periods p where p.id = period_id and private.in_org(p.org_id) and private.can_acc(p.unit_id)));
create policy acc_period_snapshot_read on public.acc_period_snapshot for select to authenticated
  using (exists (select 1 from public.acc_periods p where p.id = period_id and private.in_org(p.org_id) and private.can_acc(p.unit_id)));
create policy acc_change_reviews_read on public.acc_change_reviews for select to authenticated
  using (exists (select 1 from public.acc_periods p where p.id = period_id and private.in_org(p.org_id) and private.can_acc(p.unit_id)));
create policy acc_exports_read on public.acc_exports for select to authenticated using (private.in_org(org_id) and private.can_acc(unit_id));

-- auditoria automática (valores só das colunas listadas)
create trigger audit_acc_periods after insert or update on public.acc_periods for each row execute function private.audit_row('status','competence_month','close_seq');
create trigger audit_acc_classifications after insert or update or delete on public.acc_classifications for each row execute function private.audit_row('source_type','source_id','account_id');
create trigger audit_acc_waivers after insert or delete on public.acc_waivers for each row execute function private.audit_row('source_type','source_id','waiver_kind','reason');
create trigger audit_acc_documents after insert or update on public.acc_documents for each row execute function private.audit_row('source_type','source_id','kind','title','removed_at','competence_month');
create trigger audit_acc_grants after insert or update on public.acc_grants for each row execute function private.audit_row('user_id','permission','unit_id','revoked_at');
create trigger audit_acc_settings after insert or update on public.acc_settings for each row execute function private.audit_row('require_receipt_paid_expenses','receipt_min_cents','block_close_with_unclassified','reopen_min_reason_len');
create trigger audit_acc_accounts after insert or update on public.acc_accounts for each row execute function private.audit_row('code','name','kind','active');

-- ---------------------------------------------------------------- storage privado
insert into storage.buckets (id, name, public) values ('accounting-private', 'accounting-private', false) on conflict (id) do nothing;
-- convenção do caminho: {org_id}/{unit_id}/{yyyy-mm}/{uuid}-{arquivo}; a política confere organização E unidade
create or replace function private.acc_path_unit(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 2)::uuid end
$$;
create policy acc_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'accounting-private' and split_part(name, '/', 1) = private.current_org()::text and private.can_acc(private.acc_path_unit(name)));
create policy acc_storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'accounting-private' and split_part(name, '/', 1) = private.current_org()::text and private.can_acc(private.acc_path_unit(name)));
-- sem policy de UPDATE/DELETE: documentos contábeis não são apagados pelo usuário (remoção é lógica, com justificativa)

-- ---------------------------------------------------------------- LIVRO DE LANÇAMENTOS (somente leitura sobre o Financeiro)
-- Não concede EXECUTE a authenticated: só as RPCs públicas (SECURITY DEFINER, que checam can_acc) chamam estas funções.
create or replace function private.acc_ledger(p_org uuid, p_unit uuid, p_month date, p_basis text, p_names boolean)
returns table (
  source_type text, source_id uuid, basis text, entry_date date, competence_month date, kind text,
  description text, counterparty text, amount_cents bigint, signed_cents bigint, row_status text,
  target_type text, target_id uuid, category_name text,
  account_id uuid, account_name text, suggested_account_id uuid, suggested_account_name text,
  classified boolean, waived_class boolean, doc_count int, waived_receipt boolean, needs_receipt boolean, fingerprint text)
language sql stable security definer set search_path = '' as $$
with cfg as (
  select coalesce((select s.require_receipt_paid_expenses from public.acc_settings s where s.org_id = p_org), true) as req,
         coalesce((select s.receipt_min_cents from public.acc_settings s where s.org_id = p_org), 0) as minc,
         coalesce((select un.timezone from public.units un where un.id = p_unit), 'America/Sao_Paulo') as tz,
         date_trunc('month', p_month)::date as m0
),
comp_rec as (
  select 'receivable'::text st, r.id sid, 'competencia'::text b, r.due_date ed, r.competence_month cm, 'income'::text k,
    coalesce(pr.name, 'Parcela ' || r.installment_no || '/' || r.installments_total) d,
    case when p_names then pe.full_name else 'Paciente ' || upper(left(replace(r.person_id::text, '-', ''), 6)) end cp,
    r.amount_cents amt, r.amount_cents sg, r.status stt, 'receivable'::text tt, r.id tid, null::text cat,
    md5('receivable|' || r.id || '|' || r.competence_month || '|' || r.amount_cents || '|' || r.unit_id) fp
  from public.receivables r cross join cfg
  left join public.products pr on pr.id = r.product_id left join public.people pe on pe.id = r.person_id
  where p_basis = 'competencia' and r.org_id = p_org and r.unit_id = p_unit and r.competence_month = cfg.m0 and r.status <> 'cancelled'
),
comp_pay as (
  select 'payable'::text st, py.id sid, 'competencia'::text b, py.due_date ed, py.competence_month cm, 'expense'::text k,
    py.description d, coalesce(py.supplier, '—') cp, py.amount_cents amt, -py.amount_cents sg, py.status stt, 'payable'::text tt, py.id tid, fc.name cat,
    md5('payable|' || py.id || '|' || py.competence_month || '|' || py.amount_cents || '|' || py.unit_id) fp
  from public.payables py cross join cfg left join public.finance_categories fc on fc.id = py.category_id
  where p_basis = 'competencia' and py.org_id = p_org and py.unit_id = p_unit and py.competence_month = cfg.m0 and py.status <> 'cancelled'
),
cash_in as (
  select 'payment'::text st, pm.id sid, 'caixa'::text b, (pm.paid_at at time zone cfg.tz)::date ed, r.competence_month cm, 'income'::text k,
    (case pm.kind when 'refund' then 'Estorno — ' else 'Recebimento — ' end) || coalesce(pr.name, 'Parcela ' || r.installment_no || '/' || r.installments_total) d,
    case when p_names then pe.full_name else 'Paciente ' || upper(left(replace(r.person_id::text, '-', ''), 6)) end cp,
    pm.amount_cents amt, (case pm.kind when 'refund' then -pm.amount_cents else pm.amount_cents end) sg, pm.kind stt, 'receivable'::text tt, r.id tid, null::text cat,
    md5('payment|' || pm.id || '|' || (pm.paid_at at time zone cfg.tz)::date || '|' || pm.kind || '|' || pm.amount_cents) fp
  from public.payments pm cross join cfg join public.receivables r on r.id = pm.receivable_id
  left join public.products pr on pr.id = r.product_id left join public.people pe on pe.id = r.person_id
  where p_basis = 'caixa' and pm.org_id = p_org and pm.unit_id = p_unit
    and (pm.paid_at at time zone cfg.tz)::date >= cfg.m0 and (pm.paid_at at time zone cfg.tz)::date < (cfg.m0 + interval '1 month')::date
),
cash_out as (
  select 'payable'::text st, py.id sid, 'caixa'::text b, (py.paid_at at time zone cfg.tz)::date ed, py.competence_month cm, 'expense'::text k,
    py.description d, coalesce(py.supplier, '—') cp, py.amount_cents amt, -py.amount_cents sg, py.status stt, 'payable'::text tt, py.id tid, fc.name cat,
    md5('payablecash|' || py.id || '|' || (py.paid_at at time zone cfg.tz)::date || '|' || py.amount_cents) fp
  from public.payables py cross join cfg left join public.finance_categories fc on fc.id = py.category_id
  where p_basis = 'caixa' and py.org_id = p_org and py.unit_id = p_unit and py.status = 'paid' and py.paid_at is not null
    and (py.paid_at at time zone cfg.tz)::date >= cfg.m0 and (py.paid_at at time zone cfg.tz)::date < (cfg.m0 + interval '1 month')::date
),
u as (select * from comp_rec union all select * from comp_pay union all select * from cash_in union all select * from cash_out)
select u.st, u.sid, u.b, u.ed, u.cm, u.k, u.d, u.cp, u.amt, u.sg, u.stt, u.tt, u.tid, u.cat,
  cl.account_id, ca.name, sug.account_id, sa.name,
  (cl.account_id is not null),
  exists (select 1 from public.acc_waivers w where w.source_type = u.tt and w.source_id = u.tid and w.waiver_kind = 'classification'),
  (select count(*)::int from public.acc_documents dd where dd.org_id = p_org and dd.source_type = u.st and dd.source_id = u.sid and dd.removed_at is null),
  exists (select 1 from public.acc_waivers w where w.source_type = u.st and w.source_id = u.sid and w.waiver_kind = 'receipt'),
  (u.st = 'payable' and u.stt = 'paid' and cfg.req and u.amt >= cfg.minc),
  u.fp
from u cross join cfg
left join public.acc_classifications cl on cl.source_type = u.tt and cl.source_id = u.tid
left join public.acc_accounts ca on ca.id = cl.account_id
left join lateral (select m.account_id from public.payables py2 join public.acc_category_map m on m.category_id = py2.category_id where u.tt = 'payable' and py2.id = u.tid) sug on true
left join public.acc_accounts sa on sa.id = sug.account_id
order by u.ed, u.d, u.sid
$$;

-- Alterações do Financeiro posteriores ao fechamento: compara o livro atual com a impressão digital gravada no fechamento.
-- Não exibe as já aceitas (acc_change_reviews com a mesma impressão digital atual).
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
where not exists (select 1 from public.acc_change_reviews r where r.period_id = per.id and r.source_type = j.st and r.source_id = j.sid and r.basis = j.b and r.fingerprint = j.fp)
$$;

-- Indicadores da competência (uma linha de verdade para dashboard, competências, fechamento e exportação)
create or replace function private.acc_metrics(p_org uuid, p_unit uuid, p_month date) returns jsonb
language sql stable security definer set search_path = '' as $$
with c as (select * from private.acc_ledger(p_org, p_unit, p_month, 'competencia', false)),
k as (select * from private.acc_ledger(p_org, p_unit, p_month, 'caixa', false)),
allrows as (select l.source_id, l.needs_receipt, l.doc_count, l.waived_receipt from c l union all select l2.source_id, l2.needs_receipt, l2.doc_count, l2.waived_receipt from k l2)
select jsonb_build_object(
  'entries_comp', (select count(*) from c),
  'income_comp_cents', coalesce((select sum(signed_cents) from c where kind = 'income'), 0),
  'expense_comp_cents', coalesce((select -sum(signed_cents) from c where kind = 'expense'), 0),
  'entries_cash', (select count(*) from k),
  'cash_in_cents', coalesce((select sum(signed_cents) from k where kind = 'income'), 0),
  'cash_out_cents', coalesce((select -sum(signed_cents) from k where kind = 'expense'), 0),
  'unclassified', (select count(*) from c where not classified and not waived_class),
  'missing_receipt', (select count(distinct source_id) from allrows where needs_receipt and doc_count = 0 and not waived_receipt),
  'documents', (select count(*) from public.acc_documents d where d.org_id = p_org and d.unit_id = p_unit and d.competence_month = date_trunc('month', p_month)::date and d.removed_at is null),
  'changes_after_close', (select count(*) from private.acc_changes(p_org, p_unit, p_month))
)
$$;

grant execute on function private.can_acc(uuid), private.can_acc_any(), private.can_acc_admin(), private.can_acc_see_names(uuid),
  private.has_acc_grant(text, uuid), private.acc_path_unit(text) to authenticated;
