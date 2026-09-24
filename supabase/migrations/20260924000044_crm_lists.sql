-- HP Group Hub — 044 Listas/segmentos do CRM. Feature nova: uma lista é um grupo estático e curado de pessoas
-- (não um filtro salvo/dinâmico) — mesma distinção do CRM de referência. Nunca duplica o cadastro de pessoa:
-- lead_list_members só referencia public.people, a edição continua em Pessoas.

create table public.crm_lead_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(btrim(name)) > 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table public.crm_lead_list_members (
  list_id uuid not null references public.crm_lead_lists(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (list_id, person_id)
);

alter table public.crm_lead_lists enable row level security;
alter table public.crm_lead_list_members enable row level security;
grant select, insert, update, delete on public.crm_lead_lists to authenticated;
grant select, insert, delete on public.crm_lead_list_members to authenticated;

-- leitura/escrita: quem já acessa o CRM (mesmo critério de private.is_staff() já usado em Pessoas/CRM) — lista
-- é uma ferramenta de trabalho comercial, não algo que precise de aprovação extra pra criar.
create policy crm_lists_read on public.crm_lead_lists for select to authenticated using (private.in_org(org_id));
create policy crm_lists_write on public.crm_lead_lists for insert to authenticated with check (private.in_org(org_id));
create policy crm_lists_update on public.crm_lead_lists for update to authenticated using (private.in_org(org_id)) with check (private.in_org(org_id));
create policy crm_lists_delete on public.crm_lead_lists for delete to authenticated using (private.in_org(org_id));
create policy crm_list_members_read on public.crm_lead_list_members for select to authenticated
  using (exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id)));
create policy crm_list_members_write on public.crm_lead_list_members for insert to authenticated
  with check (exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id)));
create policy crm_list_members_delete on public.crm_lead_list_members for delete to authenticated
  using (exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id)));
